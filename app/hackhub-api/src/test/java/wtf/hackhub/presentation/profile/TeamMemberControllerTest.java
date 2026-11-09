package wtf.hackhub.presentation.profile;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import wtf.hackhub.application.profile.SearchTeamMembersUseCase;
import wtf.hackhub.infrastructure.config.SecurityConfig;
import wtf.hackhub.infrastructure.security.JwtAuthFilter;
import wtf.hackhub.infrastructure.security.JwtProvider;
import wtf.hackhub.presentation.common.GlobalExceptionHandler;
import wtf.hackhub.support.MockAuthHelper;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(TeamMemberController.class)
@Import({SecurityConfig.class, JwtAuthFilter.class, GlobalExceptionHandler.class, SearchTeamMembersUseCase.class})
@TestPropertySource(properties = {"app.cors.allowed-origins=http://localhost:5173"})
class TeamMemberControllerTest {
	@Autowired
	MockMvc mvc;
	@MockBean
	JwtProvider jwtProvider;

	@Test
	void participant_searches_the_actual_workbook_without_profile_data() throws Exception {
		mvc.perform(get("/api/v1/team-members/search").param("q", "wang weimin")
				.with(MockAuthHelper.asParticipant(UUID.randomUUID()))).andExpect(status().isOk())
				.andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].name").value("WANG Weimin"))
				.andExpect(jsonPath("$[0].orgUnit").value("BD/SLP-CO"))
				.andExpect(jsonPath("$[0].length()").value(3)).andExpect(jsonPath("$[0].email").doesNotExist())
				.andExpect(jsonPath("$[0].fullName").doesNotExist());
	}

	@Test
	void searches_chinese_and_english_keywords_with_at_prefixes() throws Exception {
		for (String query : new String[]{"@卫民", "＠卫民", "@weimin", "＠WEIMIN"}) {
			mvc.perform(get("/api/v1/team-members/search").param("q", query)
					.with(MockAuthHelper.asParticipant(UUID.randomUUID()))).andExpect(status().isOk())
					.andExpect(jsonPath("$.length()").value(1))
					.andExpect(jsonPath("$[0].name").value("WANG Weimin"));
		}
		mvc.perform(get("/api/v1/team-members/search").param("q", "＠王")
				.with(MockAuthHelper.asParticipant(UUID.randomUUID()))).andExpect(status().isOk())
				.andExpect(jsonPath("$.length()").value(20));
	}

	@Test
	void anonymous_cannot_read_the_directory() throws Exception {
		mvc.perform(get("/api/v1/team-members/search").param("q", "wang")).andExpect(status().isUnauthorized());
	}

	@Test
	void validates_query_and_returns_empty_for_missing_query() throws Exception {
		mvc.perform(get("/api/v1/team-members/search").param("q", "a".repeat(201))
				.with(MockAuthHelper.asParticipant(UUID.randomUUID()))).andExpect(status().isBadRequest());
		mvc.perform(get("/api/v1/team-members/search").with(MockAuthHelper.asParticipant(UUID.randomUUID())))
				.andExpect(status().isOk()).andExpect(content().json("[]"));
	}
}
