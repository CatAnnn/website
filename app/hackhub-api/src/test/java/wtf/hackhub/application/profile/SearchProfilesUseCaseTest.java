package wtf.hackhub.application.profile;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import wtf.hackhub.domain.Profile;
import wtf.hackhub.infrastructure.persistence.auth.ProfileRepository;

import java.util.List;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class SearchProfilesUseCaseTest {
	private final ProfileRepository profiles = mock(ProfileRepository.class);
	private final SearchProfilesUseCase search = new SearchProfilesUseCase(profiles);

	@Test
	void does_not_query_directory_for_empty_or_one_character_input() {
		assertThat(search.execute(null)).isEmpty();
		assertThat(search.execute("   ")).isEmpty();
		assertThat(search.execute(" a ")).isEmpty();
		verifyNoInteractions(profiles);
	}

	@Test
	void normalizes_query_and_limits_database_results() {
		when(profiles.searchByNameOrEmail("alice@example.com", PageRequest.of(0, 20)))
				.thenReturn(List.of(new Profile("alice@example.com", "Alice", "secret")));
		assertThat(search.execute(" ALICE@example.com "))
				.containsExactly(new SearchProfilesUseCase.Match(null, "Alice", "alice@example.com"));
		verify(profiles).searchByNameOrEmail("alice@example.com", PageRequest.of(0, 20));
	}

	@Test
	void rejects_oversized_query_without_accessing_directory() {
		assertThatThrownBy(() -> search.execute("a".repeat(201))).isInstanceOf(IllegalArgumentException.class);
		verifyNoInteractions(profiles);
	}
}
