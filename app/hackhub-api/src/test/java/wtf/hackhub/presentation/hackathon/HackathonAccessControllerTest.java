package wtf.hackhub.presentation.hackathon;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import wtf.hackhub.infrastructure.config.SecurityConfig;
import wtf.hackhub.infrastructure.persistence.judging.HackathonJudgeRepository;
import wtf.hackhub.infrastructure.security.*;
import wtf.hackhub.support.MockAuthHelper;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(HackathonAccessController.class)
@Import({SecurityConfig.class, JwtAuthFilter.class})
class HackathonAccessControllerTest {
 @MockBean wtf.hackhub.application.idea.NominationApprovalDirectory directory;
 @MockBean wtf.hackhub.infrastructure.persistence.hackathon.HackathonRepository campaigns;
	@Autowired
	MockMvc mvc;
	@MockBean
	HackathonSecurityService security;
	@MockBean
	HackathonJudgeRepository judges;
	@MockBean
	JwtProvider jwtProvider;
	final UUID user = UUID.randomUUID(), campaign = UUID.randomUUID();

	@Test
	void access_metadata_is_denied_by_default() throws Exception {
		mvc.perform(get("/api/v1/hackathons/" + campaign + "/access").with(MockAuthHelper.asManager(user)))
				.andExpect(status().isOk()).andExpect(jsonPath("$.canManage").value(false))
				.andExpect(jsonPath("$.canReview").value(false));
	}

	@Test
	void authorized_manager_gets_access() throws Exception {
		when(security.canManage(eq(campaign), any())).thenReturn(true);
		mvc.perform(get("/api/v1/hackathons/" + campaign + "/access").with(MockAuthHelper.asManager(user)))
				.andExpect(status().isOk()).andExpect(jsonPath("$.canManage").value(true))
				.andExpect(jsonPath("$.canReview").value(true));
	}

	@Test
	void assignments_are_scoped_to_authenticated_user() throws Exception {
		when(judges.findAllByUserId(user)).thenReturn(List.of());
		mvc.perform(get("/api/v1/profiles/me/judge-assignments").with(MockAuthHelper.asParticipant(user)))
				.andExpect(status().isOk()).andExpect(content().json("[]"));
		verify(judges).findAllByUserId(user);
	}

	@Test
	void anonymous_cannot_query_access_or_assignments() throws Exception {
		mvc.perform(get("/api/v1/hackathons/" + campaign + "/access")).andExpect(status().isUnauthorized());
		mvc.perform(get("/api/v1/profiles/me/judge-assignments")).andExpect(status().isUnauthorized());
		verifyNoInteractions(security, judges);
	}
}
