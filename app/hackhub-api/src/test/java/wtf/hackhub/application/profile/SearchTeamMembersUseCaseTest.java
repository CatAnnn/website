package wtf.hackhub.application.profile;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.assertj.core.api.Assertions.*;

class SearchTeamMembersUseCaseTest {
	private final SearchTeamMembersUseCase search = new SearchTeamMembersUseCase(new ObjectMapper());

	SearchTeamMembersUseCaseTest() throws IOException { }

	@Test
	void finds_workbook_member_without_a_registered_profile() {
		for (String query : new String[]{"wang weimin", "  @WANG   Weimin ", "weimin wang", "wangweimin", "王卫民", "@王卫民", "＠王卫民", "＠WANG Weimin", "@卫民", "@weimin"}) {
			assertThat(search.execute(query)).singleElement().satisfies(member -> {
				assertThat(member.name()).isEqualTo("WANG Weimin");
				assertThat(member.orgUnit()).isEqualTo("BD/SLP-CO");
				assertThat(member.id()).isNotNull();
			});
		}
	}

	@Test
	void accepts_single_chinese_keyword_and_preserves_result_limit() {
		var result = search.execute("王");
		assertThat(result).hasSize(20).doesNotHaveDuplicates();
		assertThat(search.execute("@王")).isEqualTo(result);
		assertThat(search.execute("＠王")).isEqualTo(result);
		assertThat(search.execute("@a")).isEmpty();
		assertThat(search.execute("＠a")).isEmpty();
	}

	@Test
	void limits_broad_search_and_returns_stable_distinct_ids() {
		var result = search.execute("wang");
		assertThat(result).hasSize(20).doesNotHaveDuplicates();
		assertThat(result).extracting(SearchTeamMembersUseCase.Match::id).doesNotHaveDuplicates();
		assertThat(search.execute("WANG")).isEqualTo(result);
	}

	@Test
	void handles_empty_unknown_and_punctuation_queries_without_enumerating_the_roster() {
		for (String query : new String[]{null, "", "   ", "@", "a", "%_", "no-such-member-xyz", "wang nonexistent"}) {
			assertThat(search.execute(query)).isEmpty();
		}
	}

	@Test
	void rejects_long_query() {
		assertThatThrownBy(() -> search.execute("a".repeat(201))).isInstanceOf(IllegalArgumentException.class);
	}
}
