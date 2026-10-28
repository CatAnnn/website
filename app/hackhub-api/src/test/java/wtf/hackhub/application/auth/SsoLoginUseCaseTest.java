package wtf.hackhub.application.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import wtf.hackhub.domain.Profile;
import wtf.hackhub.infrastructure.persistence.auth.ProfileRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SsoLoginUseCaseTest {

	private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
	private final ProfileRepository profiles = mock(ProfileRepository.class);
	private final LoginUseCase login = mock(LoginUseCase.class);
	private final UUID tenant = UUID.randomUUID();
	private final UUID object = UUID.randomUUID();
	private final UUID profileId = UUID.randomUUID();
	private SsoLoginUseCase service;

	@BeforeEach
	void setup() {
		service = new SsoLoginUseCase(jdbc, profiles, login);
	}

	@SuppressWarnings("unchecked")
	private void bindings(List<UUID> ids) {
		when(jdbc.query(anyString(), any(RowMapper.class), eq(tenant), eq(object))).thenReturn(ids);
	}

	@Test
	void preservesBoundAccountAndRole() {
		bindings(List.of(profileId));
		Profile profile = new Profile("employee@example.invalid", "Employee", "unused");
		profile.changeRole(Profile.Role.MANAGER);
		when(profiles.findById(profileId)).thenReturn(Optional.of(profile));
		var tokens = new LoginUseCase.TokenPair("test-access", "test-refresh", profile);
		when(login.issueForAuthenticatedProfile(profile)).thenReturn(tokens);

		assertSame(tokens, service.execute(tenant, object, "employee@example.invalid", "Employee"));
		assertEquals(Profile.Role.MANAGER, tokens.profile().getRole());
		verify(profiles, never()).findByEmail(anyString());
		verify(profiles, never()).save(any());
	}

	@Test
	void unknownIdentityCannotClaimAnExistingAccount() {
		bindings(List.of());
		when(profiles.existsByEmailIgnoreCase(anyString())).thenReturn(true);
		var error = assertThrows(OAuth2AuthenticationException.class,
				() -> service.execute(tenant, object, "employee@example.invalid", "Employee"));
		assertEquals("account_not_linked", error.getError().getErrorCode());
		verify(profiles, never()).saveAndFlush(any());
		verifyNoInteractions(login);
	}

	@Test
	void deletedProfileCannotSignIn() {
		bindings(List.of(profileId));
		when(profiles.findById(profileId)).thenReturn(Optional.empty());
		assertThrows(OAuth2AuthenticationException.class,
				() -> service.execute(tenant, object, "employee@example.invalid", "Employee"));
		verifyNoInteractions(login);
	}

	@Test
	void newEmployeeGetsParticipantWithoutPassword() {
		bindings(List.of());
		when(profiles.saveAndFlush(any())).thenAnswer(call -> {
			Profile profile = call.getArgument(0);
			assertEquals(Profile.Role.PARTICIPANT, profile.getRole());
			assertNull(profile.getPasswordHash());
			assertEquals("employee@example.invalid", profile.getEmail());
			return profile;
		});
		service.execute(tenant, object, "Employee@example.invalid", "Employee");
		verify(profiles).saveAndFlush(any());
		verify(jdbc).update(anyString(), eq(tenant), eq(object), isNull(), eq("employee@example.invalid"));
		verify(login).issueForAuthenticatedProfile(any());
	}

	@Test
	void missingEmailCannotCreateAnAccount() {
		bindings(List.of());
		var error = assertThrows(OAuth2AuthenticationException.class,
				() -> service.execute(tenant, object, null, "Employee"));
		assertEquals("profile_incomplete", error.getError().getErrorCode());
		verify(profiles, never()).saveAndFlush(any());
		verifyNoInteractions(login);
	}
	@Test
	void syncsDepartmentForNewAndExistingIdentityWithoutChangingRole() {
		bindings(List.of());
		when(profiles.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
		service.execute(tenant, object, "employee@example.invalid", "Employee", " HRL-CN ");
		var captured = org.mockito.ArgumentCaptor.forClass(Profile.class);
		verify(profiles).saveAndFlush(captured.capture());
		assertEquals("HRL-CN", captured.getValue().getOrgCode());

		Profile profile = captured.getValue();
		profile.changeRole(Profile.Role.ADMIN);
		bindings(List.of(profileId));
		when(profiles.findById(profileId)).thenReturn(Optional.of(profile));
		service.execute(tenant, object, "changed@example.invalid", "Changed", "HRL-CN C/HRR-JMPCN");
		assertEquals("HRL-CN C/HRR-JMPCN", profile.getOrgCode());
		assertEquals(Profile.Role.ADMIN, profile.getRole());
		assertEquals("employee@example.invalid", profile.getEmail());
		for (String missing : new String[]{null, " ", "x".repeat(256), "bad\nvalue"}) {
			service.execute(tenant, object, null, null, missing);
			assertEquals("HRL-CN C/HRR-JMPCN", profile.getOrgCode());
		}
	}

}
