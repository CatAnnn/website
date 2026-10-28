package wtf.hackhub.infrastructure.security;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import wtf.hackhub.application.auth.SsoLoginUseCase;
import wtf.hackhub.infrastructure.config.AppProperties;
import wtf.hackhub.infrastructure.config.SsoProperties;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

class SsoAuthenticationHandlerTest {

	private static final String SENTINEL = "SYNTHETIC_SECRET_SENTINEL";
	private final Logger logger = (Logger) LoggerFactory.getLogger(SsoAuthenticationHandler.class);
	private final ListAppender<ILoggingEvent> appender = new ListAppender<>();
	private final SsoAuthenticationHandler handler = new SsoAuthenticationHandler(
			new SsoProperties(null, null, null, "https://portal.example.invalid"), mock(AppProperties.class),
			mock(SsoLoginUseCase.class));
	private Level previousLevel;

	@BeforeEach
	void captureLogs() {
		previousLevel = logger.getLevel();
		logger.setLevel(Level.WARN);
		appender.start();
		logger.addAppender(appender);
	}

	@AfterEach
	void cleanup() {
		logger.detachAppender(appender);
		logger.setLevel(previousLevel);
		appender.stop();
		SecurityContextHolder.clearContext();
	}

	@Test
	void logsSafeDiagnosticAndPreservesFailedLoginCleanup() throws IOException {
		var request = new MockHttpServletRequest();
		request.setQueryString("code=" + SENTINEL);
		request.addHeader("Authorization", "Bearer " + SENTINEL);
		var session = new MockHttpSession();
		request.setSession(session);
		SecurityContextHolder.getContext().setAuthentication(
				UsernamePasswordAuthenticationToken.authenticated(SENTINEL, SENTINEL, java.util.List.of()));
		var response = new MockHttpServletResponse();
		var failure = new OAuth2AuthenticationException(
				new OAuth2Error("invalid_id_token", SENTINEL, "https://example.invalid/" + SENTINEL), SENTINEL,
				new IllegalArgumentException(SENTINEL));

		handler.failure(request, response, failure);

		assertSafeLog("SSO_AUTH_FAILURE code=invalid_id_token exception=OAuth2AuthenticationException rootCause=IllegalArgumentException");
		assertEquals("https://portal.example.invalid/login?sso_error=failed", response.getRedirectedUrl());
		assertEquals(302, response.getStatus());
		assertTrue(session.isInvalid());
		assertNull(SecurityContextHolder.getContext().getAuthentication());
		assertEquals("no-store", response.getHeader("Cache-Control"));
		assertEquals("no-referrer", response.getHeader("Referrer-Policy"));
		assertEquals("sso_session=; Path=/api/v1/auth/oidc; Max-Age=0; Expires=Thu, 1 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax",
				response.getHeader("Set-Cookie"));
	}

	@Test
	void replacesUnknownProviderCodeWithoutLoggingItsContents() throws IOException {
		var response = new MockHttpServletResponse();
		handler.failure(new MockHttpServletRequest(), response,
				new OAuth2AuthenticationException(new OAuth2Error(SENTINEL + "\nforged-log", SENTINEL, null), SENTINEL));

		assertSafeLog("SSO_AUTH_FAILURE code=other exception=OAuth2AuthenticationException rootCause=OAuth2AuthenticationException");
		assertEquals("https://portal.example.invalid/login?sso_error=failed", response.getRedirectedUrl());
	}

	@Test
	void boundsCauseTraversalForCyclicExceptions() throws IOException {
		var failure = new BadCredentialsException(SENTINEL);
		var cause = new IllegalArgumentException(SENTINEL, failure);
		failure.initCause(cause);

		handler.failure(new MockHttpServletRequest(), new MockHttpServletResponse(), failure);

		assertSafeLog("SSO_AUTH_FAILURE code=other exception=BadCredentialsException rootCause=BadCredentialsException");
	}

	@ParameterizedTest
	@ValueSource(strings = {"account_not_linked", "profile_incomplete", "member_required"})
	void preservesExistingBrowserErrorCodes(String code) throws IOException {
		var response = new MockHttpServletResponse();
		handler.failure(new MockHttpServletRequest(), response,
				new OAuth2AuthenticationException(new OAuth2Error(code)));
		assertEquals("https://portal.example.invalid/login?sso_error=" + code, response.getRedirectedUrl());
		assertSafeLog("SSO_AUTH_FAILURE code=" + code
				+ " exception=OAuth2AuthenticationException rootCause=OAuth2AuthenticationException");
	}

	private void assertSafeLog(String expected) {
		assertEquals(1, appender.list.size());
		var event = appender.list.getFirst();
		assertEquals(Level.WARN, event.getLevel());
		assertEquals(expected, event.getFormattedMessage());
		assertFalse(event.getFormattedMessage().contains(SENTINEL));
		assertNull(event.getThrowableProxy());
		for (Object argument : event.getArgumentArray()) {
			assertInstanceOf(String.class, argument);
			assertFalse(argument.toString().contains(SENTINEL));
		}
	}
}
