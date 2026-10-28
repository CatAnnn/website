package wtf.hackhub.presentation.auth;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import wtf.hackhub.application.auth.LoginUseCase;
import wtf.hackhub.application.auth.SsoLoginUseCase;
import wtf.hackhub.domain.Profile;
import wtf.hackhub.infrastructure.config.SecurityConfig;
import wtf.hackhub.infrastructure.config.SsoSecurityConfig;
import wtf.hackhub.infrastructure.security.JwtAuthFilter;
import wtf.hackhub.infrastructure.security.JwtProvider;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.Date;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(SsoController.class)
@Import({SecurityConfig.class, SsoSecurityConfig.class, JwtAuthFilter.class})
@TestPropertySource(properties = {"app.sso.enabled=true", "app.sso.tenant-id=11111111-1111-1111-1111-111111111111",
		"app.sso.client-id=22222222-2222-2222-2222-222222222222", "app.sso.client-secret=unused-test-value",
		"app.sso.public-base-url=https://portal.example.invalid"})
class SsoFlowTest {

	private static final String TENANT = "11111111-1111-1111-1111-111111111111";
	private static final String CLIENT = "22222222-2222-2222-2222-222222222222";
	private static final String OBJECT = "33333333-3333-3333-3333-333333333333";
	private static final String ISSUER = "https://login.microsoftonline.com/" + TENANT + "/v2.0";
	private static final String CALLBACK = "/api/v1/auth/oidc/callback/bosch";
	private static final AtomicReference<String> tokenBody = new AtomicReference<>();
	private static final AtomicReference<String> receivedTokenForm = new AtomicReference<>();
	private static final RSAKey signingKey;
	private static final HttpServer provider;

	static {
		try {
			signingKey = new RSAKeyGenerator(2048).keyID("test-key").generate();
			provider = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
			provider.createContext("/keys", exchange -> {
				byte[] body = new JWKSet(signingKey.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
				exchange.getResponseHeaders().set("Content-Type", "application/json");
				exchange.sendResponseHeaders(200, body.length);
				exchange.getResponseBody().write(body);
				exchange.close();
			});
			provider.createContext("/token", exchange -> {
				receivedTokenForm.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
				byte[] body = tokenBody.get().getBytes(StandardCharsets.UTF_8);
				exchange.getResponseHeaders().set("Content-Type", "application/json");
				exchange.sendResponseHeaders(200, body.length);
				exchange.getResponseBody().write(body);
				exchange.close();
			});
			provider.start();
		} catch (Exception ex) {
			throw new ExceptionInInitializerError(ex);
		}
	}

	@Autowired
	MockMvc mvc;
	@MockBean
	ClientRegistrationRepository clients;
	@MockBean
	SsoLoginUseCase login;
	@MockBean
	JwtProvider jwt;

	@BeforeEach
	void setup() {
		String base = "http://127.0.0.1:" + provider.getAddress().getPort();
		var client = ClientRegistration.withRegistrationId("bosch").clientId(CLIENT).clientSecret("unused-test-value")
				.clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_POST)
				.authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
				.redirectUri("https://portal.example.invalid" + CALLBACK).scope("openid", "profile", "email")
				.authorizationUri(base + "/authorize").tokenUri(base + "/token").jwkSetUri(base + "/keys")
				.issuerUri(ISSUER).userNameAttributeName("sub").build();
		when(clients.findByRegistrationId("bosch")).thenReturn(client);
		when(login.execute(any(), any(), any(), any(), any())).thenReturn(new LoginUseCase.TokenPair("test-access",
				"test-refresh", new Profile("employee@example.invalid", "Employee", "unused")));
		receivedTokenForm.set(null);
	}

	@AfterAll
	static void stopProvider() {
		provider.stop(0);
	}

	@Test
	void exposesOnlyEnabledFlag() throws Exception {
		mvc.perform(get("/api/v1/auth/sso")).andExpect(status().isOk())
				.andExpect(content().json("{\"enabled\":true}", true));
	}

	@Test
	void authorizationUsesPkceNonceFixedCallbackAndRequestedScopes() throws Exception {
		var start = start("//evil.example.invalid");
		var parameters = query(start.getResponse().getRedirectedUrl());
		assertEquals("code", parameters.get("response_type"));
		assertEquals("S256", parameters.get("code_challenge_method"));
		assertNotNull(parameters.get("code_challenge"));
		assertNotNull(parameters.get("nonce"));
		assertNotNull(parameters.get("state"));
		assertEquals("https://portal.example.invalid" + CALLBACK, parameters.get("redirect_uri"));
		assertEquals(java.util.Set.of("openid", "profile", "email"),
				java.util.Set.of(parameters.get("scope").split(" ")));
		assertEquals(300, start.getRequest().getSession(false).getMaxInactiveInterval());
	}

	@Test
	void signedCallbackIssuesAppCookieAndNeverExposesProviderTokens() throws Exception {
		var start = start("/nominate");
		var session = (MockHttpSession) start.getRequest().getSession(false);
		var parameters = query(start.getResponse().getRedirectedUrl());
		prepareToken(parameters.get("nonce"), "valid");

		var result = callback(session, parameters.get("state")).andExpect(status().isFound())
				.andExpect(redirectedUrl("https://portal.example.invalid/login?redirect=%2Fnominate"))
				.andExpect(cookie().value("refresh_token", "test-refresh"))
				.andExpect(cookie().httpOnly("refresh_token", true)).andExpect(cookie().secure("refresh_token", true))
				.andExpect(cookie().path("refresh_token", "/api/v1/auth")).andReturn();
		assertTrue(result.getResponse().getHeaders("Set-Cookie").stream()
				.anyMatch(cookie -> cookie.startsWith("refresh_token=") && cookie.contains("SameSite=Strict")));
		assertTrue(session.isInvalid());
		assertFalse(result.getResponse().getRedirectedUrl().contains("token"));
		assertTrue(receivedTokenForm.get().contains("code_verifier="));
		verify(login).execute(UUID.fromString(TENANT), UUID.fromString(OBJECT), "employee@example.invalid", "Employee", "HRL-CN C/HRR-JMPCN");
	}

	@ParameterizedTest
	@ValueSource(strings = {"missing_department", "invalid_department"})
	void absentOrMalformedDepartmentDoesNotBlockVerifiedIdentity(String defect) throws Exception {
		var start = start("/");
		var parameters = query(start.getResponse().getRedirectedUrl());
		prepareToken(parameters.get("nonce"), defect);
		callback((MockHttpSession) start.getRequest().getSession(false), parameters.get("state"))
				.andExpect(cookie().exists("refresh_token"));
		verify(login).execute(eq(UUID.fromString(TENANT)), eq(UUID.fromString(OBJECT)), anyString(), anyString(), isNull());
	}

	@ParameterizedTest
	@ValueSource(strings = {"nonce", "issuer", "audience", "expired", "signature", "tenant", "missing_oid"})
	void rejectsInvalidIdentityToken(String defect) throws Exception {
		var start = start("/overview");
		var parameters = query(start.getResponse().getRedirectedUrl());
		prepareToken(parameters.get("nonce"), defect);
		callback((MockHttpSession) start.getRequest().getSession(false), parameters.get("state"))
				.andExpect(redirectedUrl("https://portal.example.invalid/login?sso_error=failed"))
				.andExpect(cookie().doesNotExist("refresh_token"));
		verifyNoInteractions(login);
	}

	@Test
	void rejectsWrongStateBeforeTokenExchange() throws Exception {
		var start = start("/overview");
		callback((MockHttpSession) start.getRequest().getSession(false), "wrong-state")
				.andExpect(redirectedUrl("https://portal.example.invalid/login?sso_error=failed"));
		assertNull(receivedTokenForm.get());
		verifyNoInteractions(login);
	}

	@ParameterizedTest
	@ValueSource(strings = {"guest", "missing_acct"})
	void requiresTenantMembershipClaim(String defect) throws Exception {
		var start = start("/overview");
		var parameters = query(start.getResponse().getRedirectedUrl());
		prepareToken(parameters.get("nonce"), defect);
		String code = defect.equals("guest") ? "member_required" : "profile_incomplete";
		callback((MockHttpSession) start.getRequest().getSession(false), parameters.get("state"))
				.andExpect(redirectedUrl("https://portal.example.invalid/login?sso_error=" + code))
				.andExpect(cookie().doesNotExist("refresh_token"));
		verifyNoInteractions(login);
	}

	@Test
	void rejectsCallbackWithoutBrowserSession() throws Exception {
		mvc.perform(get(CALLBACK).secure(true).param("code", "test-code").param("state", "unknown"))
				.andExpect(redirectedUrl("https://portal.example.invalid/login?sso_error=failed"));
		assertNull(receivedTokenForm.get());
		verifyNoInteractions(login);
	}

	@Test
	void unlinkedAccountGetsActionableErrorWithoutSession() throws Exception {
		when(login.execute(any(), any(), any(), any(), any()))
				.thenThrow(new OAuth2AuthenticationException(new OAuth2Error("account_not_linked")));
		var start = start("/overview");
		var parameters = query(start.getResponse().getRedirectedUrl());
		prepareToken(parameters.get("nonce"), "valid");
		callback((MockHttpSession) start.getRequest().getSession(false), parameters.get("state"))
				.andExpect(redirectedUrl("https://portal.example.invalid/login?sso_error=account_not_linked"))
				.andExpect(cookie().doesNotExist("refresh_token"));
	}

	@Test
	void temporarySsoSessionDoesNotAuthenticateBusinessApi() throws Exception {
		var start = start("/overview");
		mvc.perform(get("/api/v1/profiles/me").session((MockHttpSession) start.getRequest().getSession(false)))
				.andExpect(status().isUnauthorized());
	}

	private MvcResult start(String destination) throws Exception {
		return mvc.perform(get("/api/v1/auth/oidc/authorize/bosch").secure(true).param("redirect", destination))
				.andExpect(status().isFound()).andReturn();
	}

	private org.springframework.test.web.servlet.ResultActions callback(MockHttpSession session, String state)
			throws Exception {
		return mvc
				.perform(get(CALLBACK).secure(true).session(session).param("code", "test-code").param("state", state));
	}

	private void prepareToken(String nonce, String defect) throws Exception {
		Instant now = Instant.now();
		var claims = new JWTClaimsSet.Builder().subject("test-subject")
				.issuer(defect.equals("issuer") ? "https://other.example.invalid" : ISSUER)
				.audience(defect.equals("audience") ? "other-client" : CLIENT).issueTime(Date.from(now.minusSeconds(5)))
				.expirationTime(Date.from(defect.equals("expired") ? now.minusSeconds(120) : now.plusSeconds(300)))
				.claim("email", "employee@example.invalid").claim("name", "Employee")
				.claim("department", defect.equals("missing_department") ? null : defect.equals("invalid_department") ? java.util.List.of("HRL") : "HRL-CN C/HRR-JMPCN")
				.claim("nonce", defect.equals("nonce") ? "wrong-nonce" : nonce)
				.claim("tid", defect.equals("tenant") ? "44444444-4444-4444-4444-444444444444" : TENANT);
		if (!defect.equals("missing_acct")) {
			claims.claim("acct", defect.equals("guest") ? 1 : 0);
		}
		if (!defect.equals("missing_oid")) {
			claims.claim("oid", OBJECT);
		}
		var token = new SignedJWT(
				new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT).keyID(signingKey.getKeyID()).build(),
				claims.build());
		token.sign(new RSASSASigner(defect.equals("signature") ? new RSAKeyGenerator(2048).generate() : signingKey));
		tokenBody.set("{\"access_token\":\"provider-test-token\",\"token_type\":\"Bearer\",\"expires_in\":300,"
				+ "\"scope\":\"openid profile email\",\"id_token\":\"" + token.serialize() + "\"}");
	}

	private static Map<String, String> query(String uri) {
		return Arrays.stream(URI.create(uri).getRawQuery().split("&")).map(pair -> pair.split("=", 2))
				.collect(Collectors.toMap(pair -> pair[0], pair -> URLDecoder.decode(pair[1], StandardCharsets.UTF_8)));
	}
}
