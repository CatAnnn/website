package wtf.hackhub.application.admin;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import wtf.hackhub.infrastructure.persistence.auth.ProfileRepository;

import java.util.UUID;

@Service
public class DeleteUserUseCase {

	private final ProfileRepository profileRepository;

	public DeleteUserUseCase(ProfileRepository profileRepository) {
		this.profileRepository = profileRepository;
	}

	@Transactional
	@PreAuthorize("hasRole('ADMIN')")
	public void execute(UUID targetUserId, UUID requestingUserId) {
		if (targetUserId.equals(requestingUserId)) {
			throw new AccessDeniedException("Administrators cannot delete their own account");
		}
		if (!profileRepository.existsById(targetUserId)) {
			throw new UserNotFoundException(targetUserId);
		}
		try {
			profileRepository.deleteById(targetUserId);
			// Flush here so a protected account produces an actionable API error.
			profileRepository.flush();
		} catch (DataIntegrityViolationException ex) {
			throw new IllegalArgumentException(
					"This account has linked awards, nominations or voting records and cannot be deleted. Preserve the account to keep award history.");
		}
	}

	public static class UserNotFoundException extends RuntimeException {
		public UserNotFoundException(UUID id) {
			super("User not found: " + id);
		}
	}
}
