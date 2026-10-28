package wtf.hackhub.application.idea;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.server.ResponseStatusException;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;
import wtf.hackhub.infrastructure.security.StorageSecurityService;
import wtf.hackhub.support.PostgresIntegrationTest;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

class NominationApprovalIT extends PostgresIntegrationTest {
	@Autowired SubmitIdeaUseCase submit;
	@Autowired NominationApprovalService approvals;
	@Autowired NominationApprovalDirectory directory;
	@Autowired IdeaRepository ideas;
	@Autowired GetIdeasUseCase getIdeas;
	@Autowired VoteIdeaUseCase votes;
	@Autowired CommentUseCase comments;
	@Autowired ScoreIdeaUseCase scores;
	@Autowired StorageSecurityService storage;
	UUID employee, hod, outsider, campaign;
	NominationApprovalDirectory.Employee roster;

	@BeforeEach
	void identities() throws Exception {
		try (var input = new ClassPathResource("nomination-roster.json").getInputStream()) {
			List<NominationApprovalDirectory.Employee> rows = new ObjectMapper().readValue(input, new TypeReference<>() { });
			roster = rows.stream().filter(e -> e.email() != null && !e.email().isBlank() && e.hodEmail() != null
					&& !e.email().equalsIgnoreCase(e.hodEmail())).findFirst().orElseThrow();
		}
		employee = UUID.fromString(insertProfile(roster.email(), "Editable employee name", "participant"));
		hod = UUID.fromString(insertProfile(roster.hodEmail(), "Editable HoD name", "participant"));
		outsider = UUID.fromString(insertProfile("outsider@example.invalid", roster.nominatingHead(), "participant"));
		bind(employee, roster.email());
		bind(hod, roster.hodEmail());
		campaign = jdbc.queryForObject("INSERT INTO hackathons(title,description,start_date,end_date,registration_key,allowed_participants,created_by,status,visibility) VALUES ('Approval test','Details',now(),now() + interval '30 days','approval-test',1000,?,'running','public') RETURNING id", UUID.class, employee);
	}
	void bind(UUID profile, String email) {
		jdbc.update("INSERT INTO sso_identities(tenant_id,object_id,profile_id,verified_email) VALUES (?,?,?,?)", UUID.randomUUID(), UUID.randomUUID(), profile, email);
	}
	Idea nomination(String title) {
		return submit.executeNomination(title, "Actual employee evidence", campaign, null, employee, "Customer Values", List.of(),
				Idea.Status.COMPLETED, null, null, "[{\"type\":\"nomination\",\"nomineeUserId\":\"" + employee
				+ "\",\"name\":\"Forged name\",\"nominatingHead\":\"Forged HoD\"},{\"type\":\"screenshot\",\"storageKey\":\"nominations/"
				+ campaign + "/" + employee + "/photo.png\"}]");
	}
	NominationApprovalService.Selection selection(Idea idea) {
		return new NominationApprovalService.Selection(idea.getId(), idea.getApprovalVersion());
	}
	@Test
	void verified_employee_routes_to_hod_and_unpublished_content_is_private() {
		Idea idea = nomination("Real case");
		assertThat(idea.getApprovalStatus()).isEqualTo("pending");
		assertThat(idea.getStatus()).isEqualTo(Idea.Status.SUBMITTED);
		assertThat(idea.getProjectAttachments()).contains(roster.name(), roster.orgUnit()).doesNotContain("Forged");
		assertThat(approvals.mine(employee)).extracting(Idea::getId).containsExactly(idea.getId());
		assertThat(approvals.assigned(hod)).extracting(Idea::getId).containsExactly(idea.getId());
		assertThat(approvals.canRead(idea, employee)).isTrue();
		assertThat(approvals.canRead(idea, hod)).isTrue();
		assertThat(approvals.canRead(idea, outsider)).isFalse();
		assertThat(getIdeas.listByHackathon(campaign, PageRequest.of(0, 10))).isEmpty();
		assertThat(ideas.findByHackathonIdAndStatusNotOrderByCreatedAtDesc(campaign, Idea.Status.DRAFT, PageRequest.of(0, 10))).isEmpty();
		assertThat(ideas.findAllByHackathonId(campaign)).isEmpty();
		assertThatThrownBy(() -> getIdeas.getById(idea.getId())).isInstanceOf(ResponseStatusException.class);
		assertThatThrownBy(() -> votes.execute(idea.getId(), outsider)).isInstanceOf(ResponseStatusException.class);
		assertThatThrownBy(() -> scores.execute(idea.getId(), outsider, UUID.randomUUID(), 5)).isInstanceOf(ResponseStatusException.class);
		assertThatThrownBy(() -> comments.add(idea.getId(), outsider, "Comment")).isInstanceOf(ResponseStatusException.class);
		assertThatThrownBy(() -> comments.listForIdea(idea.getId())).isInstanceOf(ResponseStatusException.class);
		String key = "nominations/" + campaign + "/" + employee + "/photo.png";
		var outsideAuth = new UsernamePasswordAuthenticationToken(outsider, null, List.of(new SimpleGrantedAuthority("ROLE_PARTICIPANT")));
		var hodAuth = new UsernamePasswordAuthenticationToken(hod, null, List.of(new SimpleGrantedAuthority("ROLE_PARTICIPANT")));
		assertThatThrownBy(() -> storage.requireAccess("project-attachments", key, false, outsideAuth))
				.isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
		assertThatCode(() -> storage.requireAccess("project-attachments", key, false, hodAuth)).doesNotThrowAnyException();
		approvals.decide(hod, List.of(selection(idea)), "approved", "");
		assertThat(getIdeas.listByHackathon(campaign, PageRequest.of(0, 10))).hasSize(1);
		assertThat(ideas.findByHackathonIdAndStatusNotOrderByCreatedAtDesc(campaign, Idea.Status.DRAFT, PageRequest.of(0, 10))).hasSize(1);
	}
	@Test
	void batch_is_atomic_and_rejection_resubmits_with_new_version() {
		Idea first = nomination("First"), second = nomination("Second");
		assertThatThrownBy(() -> approvals.decide(hod, List.of(selection(first), new NominationApprovalService.Selection(second.getId(), 999)), "approved", ""))
				.isInstanceOf(ResponseStatusException.class);
		assertThat(ideas.findById(first.getId()).orElseThrow().getApprovalStatus()).isEqualTo("pending");
		assertThatThrownBy(() -> approvals.decide(outsider, List.of(selection(first)), "approved", ""))
				.isInstanceOf(ResponseStatusException.class);
		assertThatThrownBy(() -> approvals.decide(hod, List.of(selection(first)), "rejected", ""))
				.isInstanceOf(IllegalArgumentException.class);
		Idea rejected = approvals.decide(hod, List.of(selection(first)), "rejected", "Add evidence").getFirst();
		assertThat(rejected.getApprovalReason()).isEqualTo("Add evidence");
		assertThatThrownBy(() -> submit.update(first.getId(), employee, "Edited", "Real evidence", "Customer Values", List.of(), null, null, null, first.getProjectAttachments(), first.getApprovalVersion()))
				.isInstanceOf(ResponseStatusException.class);
		Idea resubmitted = submit.update(first.getId(), employee, "Edited", "Real evidence", "Customer Values", List.of(), null, null, null, first.getProjectAttachments(), rejected.getApprovalVersion());
		assertThat(resubmitted.getApprovalStatus()).isEqualTo("pending");
		assertThat(resubmitted.getApprovalReason()).isNull();
		assertThat(resubmitted.getApprovalVersion()).isEqualTo(3);
		approvals.decide(hod, List.of(selection(resubmitted), selection(second)), "approved", "");
		assertThat(jdbc.queryForObject("SELECT count(*) FROM nomination_approval_events", Integer.class)).isEqualTo(6);
		assertThatThrownBy(() -> submit.update(first.getId(), employee, "After approval", "Change", "Customer Values", List.of(), null, null, null, first.getProjectAttachments(), 4))
				.isInstanceOf(ResponseStatusException.class);
	}
	@Test
	void names_and_local_profile_email_never_grant_approval_permissions() {
		assertThat(approvals.eligibility(outsider).canReview()).isFalse();
		assertThat(approvals.eligibility(outsider).canSubmit()).isFalse();
		jdbc.update("UPDATE profiles SET name=?,email=? WHERE id=?", roster.nominatingHead(), "local-copy@example.invalid", outsider);
		assertThat(directory.reviewerKey(outsider)).isEmpty();
		jdbc.update("UPDATE sso_identities SET verified_email=NULL WHERE profile_id=?", hod);
		assertThat(directory.reviewerKey(hod)).isEmpty();
		assertThatThrownBy(() -> approvals.assigned(hod)).isInstanceOf(ResponseStatusException.class);
	}
	@Test
	void confirmed_roster_emails_resolve_but_missing_verified_email_blocks_submission() throws Exception {
		List<NominationApprovalDirectory.Employee> rows;
		try (var input = new ClassPathResource("nomination-roster.json").getInputStream()) {
			rows = new ObjectMapper().readValue(input, new TypeReference<>() { });
		}
		assertThat(rows).hasSize(562).allSatisfy(row -> {
			assertThat(row.email()).isNotBlank();
			assertThat(row.hodEmail()).isNotBlank();
		});
		UUID confirmedUser = UUID.fromString(insertProfile("confirmed@example.invalid", "Employee", "participant"));
		bind(confirmedUser, "cpy8sgh@bosch.com");
		assertThat(approvals.eligibility(confirmedUser).canSubmit()).isTrue();
		assertThat(directory.requireEmployee(confirmedUser).name()).contains("CHEN Peiyi");
		assertThat(directory.reviewerKey(hod)).contains("vio2kor@bosch.com");
		jdbc.update("UPDATE sso_identities SET verified_email=NULL WHERE profile_id=?", employee);
		assertThat(approvals.eligibility(employee).canSubmit()).isFalse();
		assertThatThrownBy(() -> nomination("Cannot submit")).isInstanceOf(IllegalArgumentException.class);
		assertThat(ideas.count()).isZero();
	}
	@Test
	void only_explicit_na_roster_hod_can_approve_own_submission() throws Exception {
		List<NominationApprovalDirectory.Employee> rows;
		try (var input = new ClassPathResource("nomination-roster.json").getInputStream()) {
			rows = new ObjectMapper().readValue(input, new TypeReference<>() { });
		}
		var selfHead = rows.stream().filter(NominationApprovalDirectory.Employee::allowSelfApproval)
				.findFirst().orElseThrow();
		UUID selfId = UUID.fromString(insertProfile(selfHead.email(), "Editable name", "participant"));
		bind(selfId, selfHead.email());
		assertThat(directory.allowsSelfApproval(selfId)).isTrue();
		assertThat(approvals.eligibility(selfId).canSubmit()).isTrue();
		assertThat(approvals.eligibility(selfId).canReview()).isTrue();
		Idea own = submit.executeNomination("Self HoD case", "Actual evidence", campaign, null, selfId,
				"Customer Values", List.of(), Idea.Status.SUBMITTED, null, null, null);
		assertThat(approvals.assigned(selfId)).extracting(Idea::getId).containsExactly(own.getId());
		assertThat(approvals.decide(selfId, List.of(selection(own)), "approved", "").getFirst().getApprovalStatus())
				.isEqualTo("approved");
		assertThat(directory.allowsSelfApproval(employee)).isFalse();
		assertThat(directory.allowsSelfApproval(hod)).isFalse();
		Idea forged = nomination("Attempted self routing");
		jdbc.update("UPDATE ideas SET created_by=?,approval_head_key=? WHERE id=?", hod, roster.hodEmail().toLowerCase(java.util.Locale.ROOT), forged.getId());
		assertThat(approvals.assigned(hod)).extracting(Idea::getId).doesNotContain(forged.getId());
		assertThatThrownBy(() -> approvals.decide(hod, List.of(selection(forged)), "approved", ""))
				.isInstanceOf(ResponseStatusException.class);
	}
	@Test
	void concurrent_reviewers_cannot_overwrite_a_decision() throws Exception {
		Idea idea = nomination("Concurrent review");
		var start = new java.util.concurrent.CountDownLatch(1);
		try (var workers = java.util.concurrent.Executors.newFixedThreadPool(2)) {
			java.util.concurrent.Callable<Boolean> approve = () -> {
				start.await();
				try {
					approvals.decide(hod, List.of(selection(idea)), "approved", "");
					return true;
				} catch (ResponseStatusException ex) {
					assertThat(ex.getStatusCode().value()).isEqualTo(409);
					return false;
				}
			};
			var first = workers.submit(approve);
			var second = workers.submit(approve);
			start.countDown();
			assertThat(List.of(first.get(), second.get())).containsExactlyInAnyOrder(true, false);
		}
		assertThat(jdbc.queryForObject("SELECT count(*) FROM nomination_approval_events WHERE decision='approved'", Integer.class)).isEqualTo(1);
	}
	@Test
	void self_approval_and_repeated_decisions_are_rejected() {
		Idea idea = nomination("One decision");
		assertThatThrownBy(() -> approvals.decide(employee, List.of(selection(idea)), "approved", ""))
				.isInstanceOf(ResponseStatusException.class);
		approvals.decide(hod, List.of(selection(idea)), "approved", "");
		assertThatThrownBy(() -> approvals.decide(hod, List.of(selection(idea)), "rejected", "Change decision"))
				.isInstanceOf(ResponseStatusException.class);
		assertThat(ideas.findById(idea.getId()).orElseThrow().getApprovalStatus()).isEqualTo("approved");
	}
	@Test
	void legacy_nominations_stay_visible() {
		Idea legacy = ideas.saveAndFlush(new Idea("Legacy", "Preserved", campaign, null, employee, "Customer Values"));
		assertThat(legacy.getApprovalStatus()).isNull();
		assertThat(getIdeas.listByHackathon(campaign, PageRequest.of(0, 10))).hasSize(1);
	}
}
