package wtf.hackhub.application.auth;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import wtf.hackhub.domain.Profile;
import wtf.hackhub.infrastructure.persistence.auth.ProfileRepository;

import java.util.UUID;
import java.util.Locale;

@Service
@ConditionalOnProperty(name = "app.sso.enabled", havingValue = "true")
public class SsoLoginUseCase {

	private final JdbcTemplate jdbc;
	private final ProfileRepository profiles;
	private final LoginUseCase login;

	public SsoLoginUseCase(JdbcTemplate jdbc, ProfileRepository profiles, LoginUseCase login) {
		this.jdbc = jdbc;
		this.profiles = profiles;
		this.login = login;
	}

	@Transactional
	public LoginUseCase.TokenPair execute(UUID tenantId, UUID objectId, String email, String name) {
		return execute(tenantId, objectId, email, name, null);
	}

	@Transactional
	public LoginUseCase.TokenPair execute(UUID tenantId, UUID objectId, String email, String name, String department) {
		var matches = jdbc.query("SELECT profile_id FROM sso_identities WHERE tenant_id = ? AND object_id = ?",
				(rs, row) -> rs.getObject("profile_id", UUID.class), tenantId, objectId);
		if (matches.size() == 1) {
			var profile = profiles.findById(matches.get(0)).orElseThrow(SsoLoginUseCase::notLinked);
			profile.syncSsoDepartment(department);
			jdbc.update("UPDATE sso_identities SET verified_email = ? WHERE tenant_id = ? AND object_id = ?",
					verifiedEmail(email), tenantId, objectId);
			return login.issueForAuthenticatedProfile(profile);
		}
		if (email == null || email.length() > 255 || !email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+") || name == null
				|| name.isBlank() || name.length() > 255) {
			throw new OAuth2AuthenticationException(new OAuth2Error("profile_incomplete"));
		}
		String normalizedEmail = email.toLowerCase(Locale.ROOT);
		// A signed email claim must never transfer ownership of an existing local
		// account.
		if (profiles.existsByEmailIgnoreCase(normalizedEmail)) {
			throw notLinked();
		}
		var newProfile = new Profile(normalizedEmail, name, null);
		newProfile.syncSsoDepartment(department);
		var profile = profiles.saveAndFlush(newProfile);
		jdbc.update("INSERT INTO sso_identities (tenant_id, object_id, profile_id, verified_email) VALUES (?, ?, ?, ?)", tenantId,
				objectId, profile.getId(), verifiedEmail(email));
		return login.issueForAuthenticatedProfile(profile);
	}

	private static String verifiedEmail(String email) {
		return email != null && email.length() <= 255 && email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")
				? email.toLowerCase(Locale.ROOT) : null;
	}

	private static OAuth2AuthenticationException notLinked() {
		return new OAuth2AuthenticationException(new OAuth2Error("account_not_linked"));
	}
}
