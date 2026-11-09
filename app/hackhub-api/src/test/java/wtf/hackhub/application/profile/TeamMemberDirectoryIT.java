package wtf.hackhub.application.profile;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import wtf.hackhub.support.MockAuthHelper;
import wtf.hackhub.support.PostgresIntegrationTest;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@AutoConfigureMockMvc
class TeamMemberDirectoryIT extends PostgresIntegrationTest {
	@Autowired
	MockMvc mvc;

	@Test
	void serves_roster_members_with_an_empty_profile_database_and_keeps_authentication_required() throws Exception {
		assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM profiles", Integer.class)).isZero();
		for (String query : new String[]{"weimin wang", "@卫民", "＠卫民", "@weimin"}) {
			mvc.perform(get("/api/v1/team-members/search").param("q", query)
					.with(MockAuthHelper.asParticipant(UUID.randomUUID()))).andExpect(status().isOk())
					.andExpect(jsonPath("$[0].name").value("WANG Weimin"))
					.andExpect(jsonPath("$[0].orgUnit").value("BD/SLP-CO"));
		}
		mvc.perform(get("/api/v1/team-members/search").param("q", "wang weimin"))
				.andExpect(status().isUnauthorized());
		assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM profiles", Integer.class)).isZero();
	}
}
