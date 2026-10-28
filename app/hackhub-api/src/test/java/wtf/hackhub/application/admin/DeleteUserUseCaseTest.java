package wtf.hackhub.application.admin;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;
import wtf.hackhub.infrastructure.persistence.auth.ProfileRepository;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DeleteUserUseCaseTest {

	@Mock
	ProfileRepository profileRepository;
	@InjectMocks
	DeleteUserUseCase useCase;

	@Test
	void deletes_another_user() {
		UUID callerId = UUID.randomUUID();
		UUID targetId = UUID.randomUUID();
		when(profileRepository.existsById(targetId)).thenReturn(true);

		useCase.execute(targetId, callerId);

		verify(profileRepository).deleteById(targetId);
	}

	@Test
	void rejects_deleting_current_user() {
		UUID userId = UUID.randomUUID();

		assertThatThrownBy(() -> useCase.execute(userId, userId)).isInstanceOf(AccessDeniedException.class);
		verify(profileRepository, never()).deleteById(userId);
	}

	@Test
	void rejects_unknown_user() {
		UUID targetId = UUID.randomUUID();
		when(profileRepository.existsById(targetId)).thenReturn(false);

		assertThatThrownBy(() -> useCase.execute(targetId, UUID.randomUUID()))
				.isInstanceOf(DeleteUserUseCase.UserNotFoundException.class);
		verify(profileRepository, never()).deleteById(targetId);
	}
	@Test
	void explainsProtectedAwardHistoryInsteadOfDeletingIt() {
		UUID target = UUID.randomUUID();
		when(profileRepository.existsById(target)).thenReturn(true);
		org.mockito.Mockito.doThrow(new org.springframework.dao.DataIntegrityViolationException("protected"))
				.when(profileRepository).flush();
		assertThatThrownBy(() -> useCase.execute(target, UUID.randomUUID()))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("cannot be deleted");
	}

}
