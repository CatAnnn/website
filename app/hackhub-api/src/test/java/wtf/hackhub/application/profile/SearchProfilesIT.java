package wtf.hackhub.application.profile;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import wtf.hackhub.support.PostgresIntegrationTest;

import static org.assertj.core.api.Assertions.*;

class SearchProfilesIT extends PostgresIntegrationTest {
	@Autowired
	SearchProfilesUseCase search;

	@Test
	void matches_names_and_emails_case_insensitively_with_exact_match_first() {
		insertProfile("partial@example.com", "Alice Zhang", "participant");
		insertProfile("alice@example.com", "Alice", "participant");
		insertProfile("manager@example.com", "Other Person", "manager");
		assertThat(search.execute(" ALICE ")).extracting(SearchProfilesUseCase.Match::name)
				.containsExactly("Alice", "Alice Zhang");
		assertThat(search.execute("ALICE@example.com")).extracting(SearchProfilesUseCase.Match::name)
				.containsExactly("Alice");
	}

	@Test
	void preserves_literal_wildcards_and_caps_the_result_set() {
		insertProfile("literal@example.com", "Percent%_Name", "participant");
		for (int index = 0; index < 25; index++) {
			insertProfile("member" + index + "@example.com", "Member " + index, "participant");
		}
		assertThat(search.execute("%_")).extracting(SearchProfilesUseCase.Match::name)
				.containsExactly("Percent%_Name");
		assertThat(search.execute("member")).hasSize(20);
		assertThat(search.execute("unknown-person")).isEmpty();
	}
}
