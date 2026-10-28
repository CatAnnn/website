package wtf.hackhub.infrastructure.config;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrations;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class SsoSigningKeysTest {
	@Test
	void requestsApplicationSpecificKeysWhileKeepingIssuerAndScopes() {
		String tenant = "11111111-1111-1111-1111-111111111111";
		String client = "22222222-2222-2222-2222-222222222222";
		var properties = new SsoProperties(tenant, client, "unused-test-value", "https://portal.example.invalid");
		var builder = ClientRegistration.withRegistrationId("test")
				.authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
				.authorizationUri("https://login.example.invalid/authorize")
				.tokenUri("https://login.example.invalid/token")
				.jwkSetUri("https://login.example.invalid/keys").issuerUri(properties.issuer());
		try (var discovery = mockStatic(ClientRegistrations.class)) {
			discovery.when(() -> ClientRegistrations.fromIssuerLocation(properties.issuer())).thenReturn(builder);
			var registration = new SsoSecurityConfig().ssoClients(properties).findByRegistrationId("bosch");
			assertThat(registration.getProviderDetails().getJwkSetUri()).isEqualTo("https://login.example.invalid/keys?appid=" + client);
			assertThat(registration.getProviderDetails().getIssuerUri()).isEqualTo(properties.issuer());
			assertThat(registration.getScopes()).containsExactlyInAnyOrder("openid", "profile", "email");
		}
	}
}
