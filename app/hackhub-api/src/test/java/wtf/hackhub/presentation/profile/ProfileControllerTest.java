package wtf.hackhub.presentation.profile;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import wtf.hackhub.application.profile.UpdateProfileUseCase;
import wtf.hackhub.application.profile.SearchProfilesUseCase;
import wtf.hackhub.domain.Profile;
import wtf.hackhub.infrastructure.config.SecurityConfig;
import wtf.hackhub.infrastructure.security.JwtAuthFilter;
import wtf.hackhub.infrastructure.security.JwtProvider;
import wtf.hackhub.presentation.common.GlobalExceptionHandler;
import wtf.hackhub.support.MockAuthHelper;

import java.util.UUID;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(ProfileController.class)
@Import({SecurityConfig.class, JwtAuthFilter.class, GlobalExceptionHandler.class})
@TestPropertySource(properties = {
		"app.jwt.private-key=-----BEGIN PRIVATE KEY-----\\nMIIEvAIBADANBg=====\\n-----END PRIVATE KEY-----",
		"app.jwt.public-key=-----BEGIN PUBLIC KEY-----\\nMIIBIjANBg=====\\n-----END PUBLIC KEY-----",
		"app.cors.allowed-origins=http://localhost:5173", "app.minio.endpoint=http://localhost:9000",
		"app.minio.access-key=test", "app.minio.secret-key=test"})
class ProfileControllerTest {

	@Autowired
	MockMvc mvc;
	@MockBean
	UpdateProfileUseCase useCase;
	@MockBean
	JwtProvider jwtProvider;
	@MockBean
	SearchProfilesUseCase searchUseCase;

	static final UUID USER_ID = UUID.randomUUID();

	@Test
	void get_me_returns_profile() throws Exception {
		when(useCase.getById(USER_ID)).thenReturn(new Profile("me@test.com", "Alice", "h"));

		mvc.perform(get("/api/v1/profiles/me").with(MockAuthHelper.asParticipant(USER_ID))).andExpect(status().isOk())
				.andExpect(jsonPath("$.email").value("me@test.com")).andExpect(jsonPath("$.role").value("participant"));
	}

	@Test
	void get_me_unauthenticated_returns_401() throws Exception {
		mvc.perform(get("/api/v1/profiles/me")).andExpect(status().isUnauthorized());
	}

	@Test
	void patch_me_updates_profile() throws Exception {
		Profile updated = new Profile("me@test.com", "New Name", "h");
		when(useCase.update(eq(USER_ID), eq("New Name"), any(), any())).thenReturn(updated);

		mvc.perform(patch("/api/v1/profiles/me").with(MockAuthHelper.asParticipant(USER_ID))
				.contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"New Name\"}")).andExpect(status().isOk())
				.andExpect(jsonPath("$.name").value("New Name"));
	}

	@Test
	void get_profile_not_found_returns_404() throws Exception {
		UUID other = UUID.randomUUID();
		when(useCase.getById(other)).thenThrow(new UpdateProfileUseCase.ProfileNotFoundException(other));

		mvc.perform(get("/api/v1/profiles/" + other).with(MockAuthHelper.asParticipant(USER_ID)))
				.andExpect(status().isNotFound());
	}

	@Test
	void search_returns_only_member_identity_fields_for_participant() throws Exception {
		when(searchUseCase.execute("alice")).thenReturn(List.of(new SearchProfilesUseCase.Match(USER_ID, "Alice", "alice@test.com")));
		mvc.perform(get("/api/v1/profiles/search").param("q", "alice").with(MockAuthHelper.asParticipant(USER_ID)))
				.andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
				.andExpect(jsonPath("$[0].id").value(USER_ID.toString()))
				.andExpect(jsonPath("$[0].name").value("Alice"))
				.andExpect(jsonPath("$[0].email").value("alice@test.com"))
				.andExpect(jsonPath("$[0].length()").value(3))
				.andExpect(jsonPath("$[0].passwordHash").doesNotExist());
	}

	@Test
	void search_unauthenticated_returns_401() throws Exception {
		mvc.perform(get("/api/v1/profiles/search").param("q", "alice")).andExpect(status().isUnauthorized());
	}

	@Test
	void search_rejects_oversized_query() throws Exception {
		String query = "a".repeat(201);
		when(searchUseCase.execute(query)).thenThrow(new IllegalArgumentException("Search query must not exceed 200 characters."));
		mvc.perform(get("/api/v1/profiles/search").param("q", query).with(MockAuthHelper.asParticipant(USER_ID)))
				.andExpect(status().isBadRequest());
	}
}
