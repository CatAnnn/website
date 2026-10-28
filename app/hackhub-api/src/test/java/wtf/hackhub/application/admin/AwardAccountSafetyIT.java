package wtf.hackhub.application.admin;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import wtf.hackhub.application.auth.LoginUseCase;
import wtf.hackhub.application.auth.SsoLoginUseCase;
import wtf.hackhub.application.idea.NomineeDirectory;
import wtf.hackhub.infrastructure.persistence.auth.ProfileRepository;
import wtf.hackhub.support.MockAuthHelper;
import wtf.hackhub.support.PostgresIntegrationTest;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
class AwardAccountSafetyIT extends PostgresIntegrationTest {
	@Autowired MockMvc mvc;
	@Autowired ProfileRepository profiles;
	@Autowired LoginUseCase login;
	@Autowired PlatformTransactionManager transactions;
	@Autowired NomineeDirectory directory;

	UUID account(String name) {
		return UUID.fromString(insertProfile(name + "@example.invalid", name, "admin"));
	}
	UUID campaign(UUID owner) {
		return jdbc.queryForObject("INSERT INTO hackathons(title,description,start_date,end_date,created_by,status,registration_key,allowed_participants) VALUES ('Award','Award',now(),now()+interval '1 day',?,'open',gen_random_uuid()::text,100) RETURNING id", UUID.class, owner);
	}
	UUID nomination(UUID campaign, UUID creator, UUID nominee) {
		return jdbc.queryForObject("INSERT INTO ideas(title,description,hackathon_id,created_by,category,status,project_attachments) VALUES ('Nominee','Impact',?,?,'Customer Values','submitted',?::jsonb) RETURNING id", UUID.class, campaign, creator,
				"[{\"type\":\"nomination\",\"nomineeUserId\":\"" + nominee + "\",\"nomineeOrgCode\":\"OLD\"},{\"type\":\"screenshot\",\"storageKey\":\"keep/photo.png\"}]");
	}

	@Test
	void originalCascadeRuleReproducesTheLossAndIsRolledBack() throws Exception {
		UUID owner = account("owner"), other = account("other");
		UUID award = campaign(owner), idea = nomination(award, other, other);
		jdbc.update("INSERT INTO idea_votes(idea_id,user_id) VALUES (?,?)", idea, other);
		try (var connection = jdbc.getDataSource().getConnection()) {
			connection.setAutoCommit(false);
			try (var statement = connection.createStatement()) {
				statement.execute("ALTER TABLE hackathons DROP CONSTRAINT hackathons_created_by_fkey, ADD CONSTRAINT hackathons_created_by_fkey FOREIGN KEY(created_by) REFERENCES profiles(id) ON DELETE CASCADE");
				try (var delete = connection.prepareStatement("DELETE FROM profiles WHERE id=?")) {
					delete.setObject(1, owner);
					delete.executeUpdate();
				}
				try (var counts = statement.executeQuery("SELECT (SELECT count(*) FROM hackathons) + (SELECT count(*) FROM ideas) + (SELECT count(*) FROM idea_votes)")) {
					counts.next();
					assertThat(counts.getInt(1)).isZero();
				}
			} finally {
				connection.rollback();
			}
		}
		assertThat(jdbc.queryForObject("SELECT count(*) FROM idea_votes", Integer.class)).isEqualTo(1);
	}

	@Test
	void deletingCreatorOrVoterCannotEraseSharedAwardsAndVotes() throws Exception {
		UUID owner = account("owner"), admin = account("admin"), voter = account("voter");
		UUID award = campaign(owner), idea = nomination(award, admin, admin);
		jdbc.update("INSERT INTO idea_votes(idea_id,user_id) VALUES (?,?)", idea, voter);
		mvc.perform(delete("/api/v1/admin/users/" + owner).with(MockAuthHelper.asAdmin(admin)))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("cannot be deleted")));
		for (UUID id : new UUID[]{owner, admin, voter}) {
			assertThatThrownBy(() -> jdbc.update("DELETE FROM profiles WHERE id=?", id))
					.isInstanceOf(DataIntegrityViolationException.class);
		}
		assertThat(jdbc.queryForObject("SELECT count(*) FROM hackathons", Integer.class)).isEqualTo(1);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM ideas", Integer.class)).isEqualTo(1);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM idea_votes", Integer.class)).isEqualTo(1);
		UUID unused = account("unused");
		mvc.perform(delete("/api/v1/admin/users/" + unused).with(MockAuthHelper.asAdmin(admin)))
				.andExpect(status().isNoContent());
		assertThat(profiles.findById(unused)).isEmpty();
	}

	@Test
	void nominationJsonReferenceProtectsAnAccountThatAuthoredNothing() {
		UUID owner = account("owner"), nominee = account("nominee");
		nomination(campaign(owner), owner, nominee);
		assertThatThrownBy(() -> jdbc.update("DELETE FROM profiles WHERE id=?", nominee))
				.isInstanceOf(DataIntegrityViolationException.class);
		assertThat(profiles.findById(nominee)).isPresent();
	}

	@Test
	void ssoDepartmentPersistsAndRefreshesExistingNominationDetails() throws Exception {
		UUID tenant = UUID.randomUUID(), object = UUID.randomUUID();
		var tx = new TransactionTemplate(transactions);
		var service = new SsoLoginUseCase(jdbc, profiles, login);
		UUID nominee = tx.execute(status -> service.execute(tenant, object, "employee@example.invalid", "Employee", "HRL-CN").profile().getId());
		UUID admin = account("admin");
		UUID idea = nomination(campaign(admin), admin, nominee);
		assertThat(profiles.findById(nominee).orElseThrow().getOrgCode()).isEqualTo("HRL-CN");
		tx.execute(status -> service.execute(tenant, object, null, null, "HRL-CN C/HRR-JMPCN"));
		tx.execute(status -> service.execute(tenant, object, null, null, null));
		assertThat(profiles.findById(nominee).orElseThrow().getOrgCode()).isEqualTo("HRL-CN C/HRR-JMPCN");
		mvc.perform(get("/api/v1/admin/users?size=200").with(MockAuthHelper.asAdmin(admin)))
				.andExpect(status().isOk()).andExpect(jsonPath("$.content[?(@.email == 'employee@example.invalid')].orgCode").value("HRL-CN C/HRR-JMPCN"));
		var result = mvc.perform(get("/api/v1/ideas/" + idea).with(MockAuthHelper.asParticipant(nominee)))
				.andExpect(status().isOk()).andReturn();
		var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
		var attachments = mapper.readTree(mapper.readTree(result.getResponse().getContentAsString()).get("projectAttachments").asText());
		assertThat(attachments.get(0).get("nomineeOrgCode").asText()).isEqualTo("HRL-CN C/HRR-JMPCN");
		assertThat(attachments.get(1).get("storageKey").asText()).isEqualTo("keep/photo.png");
		assertThat(profiles.findById(nominee).orElseThrow().getRole().toDbValue()).isEqualTo("participant");
	}
}
