package wtf.hackhub.infrastructure.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.ClientRegistrations;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.NullSecurityContextRepository;
import org.springframework.security.web.savedrequest.NullRequestCache;
import wtf.hackhub.application.auth.SsoLoginUseCase;
import wtf.hackhub.infrastructure.security.SsoAuthenticationHandler;
import wtf.hackhub.infrastructure.security.SsoAuthorizationRequestResolver;

import java.util.List;

@Configuration
@ConditionalOnProperty(name = "app.sso.enabled", havingValue = "true")
@EnableConfigurationProperties(SsoProperties.class)
public class SsoSecurityConfig {

	@Bean
	public ClientRegistrationRepository ssoClients(SsoProperties properties) {
		properties.validate();
		var registration = ClientRegistrations.fromIssuerLocation(properties.issuer()).registrationId("bosch")
				.clientName("Bosch").clientId(properties.clientId()).clientSecret(properties.clientSecret())
				.clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_POST)
				.scope("openid", "profile", "email")
				.redirectUri(properties.publicBaseUrl() + "/api/v1/auth/oidc/callback/bosch").build();
		// Entra claims mapping can use application-specific token signing keys.
		registration = ClientRegistration.withClientRegistration(registration)
				.jwkSetUri(registration.getProviderDetails().getJwkSetUri() + "?appid=" + properties.clientId())
				.build();
		return new InMemoryClientRegistrationRepository(registration);
	}

	@Bean
	@Order(1)
	public SecurityFilterChain ssoFilterChain(HttpSecurity http, ClientRegistrationRepository clients,
			SsoProperties properties, AppProperties app, SsoLoginUseCase login) throws Exception {
		var handler = new SsoAuthenticationHandler(properties, app, login);
		return http.securityMatcher("/api/v1/auth/oidc/**")
				.authorizeHttpRequests(auth -> auth
						.requestMatchers("/api/v1/auth/oidc/authorize/bosch", "/api/v1/auth/oidc/callback/bosch")
						.permitAll().anyRequest().denyAll())
				.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
				.securityContext(context -> context.securityContextRepository(new NullSecurityContextRepository()))
				.requestCache(cache -> cache.requestCache(new NullRequestCache()))
				.oauth2Login(oauth -> oauth.clientRegistrationRepository(clients)
						.authorizedClientRepository(discardProviderTokens())
						.authorizationEndpoint(endpoint -> endpoint
								.authorizationRequestResolver(new SsoAuthorizationRequestResolver(clients)))
						.redirectionEndpoint(endpoint -> endpoint.baseUri("/api/v1/auth/oidc/callback/*"))
						// Signed ID token claims suffice; do not call Graph UserInfo or request
						// User.Read.
						.userInfoEndpoint(endpoint -> endpoint
								.oidcUserService(request -> new DefaultOidcUser(List.of(), request.getIdToken())))
						.successHandler(handler::success).failureHandler(handler::failure))
				.exceptionHandling(ex -> ex.authenticationEntryPoint(
						(request, response, exception) -> response.sendError(HttpServletResponse.SC_UNAUTHORIZED)))
				.build();
	}

	private OAuth2AuthorizedClientRepository discardProviderTokens() {
		return new OAuth2AuthorizedClientRepository() {
			@Override
			public <T extends OAuth2AuthorizedClient> T loadAuthorizedClient(String id, Authentication principal,
					HttpServletRequest request) {
				return null;
			}

			@Override
			public void saveAuthorizedClient(OAuth2AuthorizedClient client, Authentication principal,
					HttpServletRequest request, HttpServletResponse response) {
				// Only our application's refresh token persists after the login handshake.
			}

			@Override
			public void removeAuthorizedClient(String id, Authentication principal, HttpServletRequest request,
					HttpServletResponse response) {
			}
		};
	}
}
