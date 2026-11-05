package wtf.hackhub.presentation.profile;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import wtf.hackhub.application.profile.SearchTeamMembersUseCase;

import java.util.List;

@RestController
@RequestMapping("/api/v1/team-members")
public class TeamMemberController {
	private final SearchTeamMembersUseCase search;

	public TeamMemberController(SearchTeamMembersUseCase search) {
		this.search = search;
	}

	@GetMapping("/search")
	public List<SearchTeamMembersUseCase.Match> search(@RequestParam(defaultValue = "") String q) {
		return search.execute(q);
	}
}
