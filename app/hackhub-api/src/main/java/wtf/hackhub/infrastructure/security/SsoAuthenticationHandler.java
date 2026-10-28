package wtf.hackhub.infrastructure.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import wtf.hackhub.application.auth.SsoLoginUseCase;
import wtf.hackhub.infrastructure.config.AppProperties;
import wtf.hackhub.infrastructure.config.SsoProperties;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public class SsoAuthenticationHandler {

	private static final Logger log = LoggerFactory.getLogger(SsoAuthenticationHandler.class);

	private final SsoProperties sso;
	private final AppProperties app;
	private final SsoLoginUseCase login;

	public SsoAuthenticationHandler(SsoProperties sso, AppProperties app, SsoLoginUseCase login) {
		this.sso = sso;
		this.app = app;
		this.login = login;
	}

	public void success(HttpServletRequest request, HttpServletResponse response, Authentication authentication)
			throws IOException {
		try {
			OidcUser user = (OidcUser) authentication.getPrincipal();
			String tenant = user.getIdToken().getClaimAsString("tid");
			String object = user.getIdToken().getClaimAsString("oid");
			if (!sso.tenantId().equals(tenant) || object == null) {
				throw new OAuth2AuthenticationException(new OAuth2Error("invalid_identity"));
			}
			Object accountType = user.getIdToken().getClaims().get("acct");
			if (accountType == null) {
				throw new OAuth2AuthenticationException(new OAuth2Error("profile_incomplete"));
			}
			if (!"0".equals(accountType.toString())) {
				throw new OAuth2AuthenticationException(new OAuth2Error("member_required"));
			}
			UUID objectId;
			try {
				objectId = UUID.fromString(object);
			} catch (IllegalArgumentException ex) {
				throw new OAuth2AuthenticationException(new OAuth2Error("invalid_identity"));
			}
			Object department = user.getIdToken().getClaims().get("department");
			var tokens = login.execute(UUID.fromString(tenant), objectId, user.getIdToken().getClaimAsString("email"),
					user.getIdToken().getClaimAsString("name"), department instanceof String value ? value : null);
			var session = request.getSession(false);
			String destination = session == null
					? null
					: (String) session.getAttribute(SsoAuthorizationRequestResolver.RETURN_TO);
			clearSession(request, response);
			response.addHeader(HttpHeaders.SET_COOKIE,
					ResponseCookie.from("refresh_token", tokens.refreshToken()).httpOnly(true).secure(true)
							.path("/api/v1/auth").sameSite("Strict").maxAge(app.jwt().refreshTokenExpirySeconds())
							.build().toString());
			// The SPA restores its own access token with POST /auth/refresh. No tokens in
			// URLs.
			redirect(response, "/login?redirect=" + URLEncoder
					.encode(SsoAuthorizationRequestResolver.safeDestination(destination), StandardCharsets.UTF_8));
		} catch (OAuth2AuthenticationException ex) {
			failure(request, response, ex);
		} catch (DataIntegrityViolationException ex) {
			// A concurrent first login must roll back, never merge accounts by email.
			failure(request, response, new OAuth2AuthenticationException(new OAuth2Error("retry_login")));
		}
	}

	public void failure(HttpServletRequest request, HttpServletResponse response, AuthenticationException failure)
			throws IOException {
		clearSession(request, response);
		String requested = failure instanceof OAuth2AuthenticationException oauth
				? oauth.getError().getErrorCode()
				: "";
		String diagnosticCode = switch (requested) {
			case "invalid_id_token", "invalid_token_response", "invalid_user_info_response", "invalid_request",
					"invalid_client", "invalid_grant", "unauthorized_client", "access_denied", "invalid_scope",
					"server_error", "temporarily_unavailable", "authorization_request_not_found", "invalid_state_parameter",
					"invalid_identity", "retry_login", "account_not_linked", "profile_incomplete", "member_required" -> requested;
			default -> "other";
		};
		Throwable rootCause = failure;
		for (int depth = 0; depth < 16 && rootCause.getCause() != null; depth++) {
			rootCause = rootCause.getCause();
		}
		// Never log provider messages, request data, token claims, or throwable stacks.
		log.warn("SSO_AUTH_FAILURE code={} exception={} rootCause={}", diagnosticCode,
				failure.getClass().getSimpleName(), rootCause.getClass().getSimpleName());
		String code = switch (requested) {
			case "account_not_linked", "profile_incomplete", "member_required" -> requested;
			default -> "failed";
		};
		redirect(response, "/login?sso_error=" + code);
	}

	private void clearSession(HttpServletRequest request, HttpServletResponse response) {
		var session = request.getSession(false);
		if (session != null) {
			session.invalidate();
		}
		SecurityContextHolder.clearContext();
		response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from("sso_session", "").httpOnly(true).secure(true)
				.path("/api/v1/auth/oidc").sameSite("Lax").maxAge(0).build().toString());
	}

	private void redirect(HttpServletResponse response, String path) throws IOException {
		response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
		response.setHeader("Referrer-Policy", "no-referrer");
		response.sendRedirect(sso.publicBaseUrl() + path);
	}
}
