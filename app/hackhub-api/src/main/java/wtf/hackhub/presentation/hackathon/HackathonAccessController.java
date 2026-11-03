package wtf.hackhub.presentation.hackathon;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import wtf.hackhub.infrastructure.security.HackathonSecurityService;
import wtf.hackhub.infrastructure.persistence.judging.HackathonJudgeRepository;

import java.util.UUID;
import java.util.List;

/**
 * Permission metadata only: safe to request before mounting a protected page.
 */
@RestController
public class HackathonAccessController {
	private final HackathonSecurityService security;
	private final HackathonJudgeRepository judges;
	private final wtf.hackhub.application.idea.NominationApprovalDirectory directory;
	private final wtf.hackhub.infrastructure.persistence.hackathon.HackathonRepository campaigns;

	public HackathonAccessController(HackathonSecurityService security, HackathonJudgeRepository judges,
			wtf.hackhub.application.idea.NominationApprovalDirectory directory,
			wtf.hackhub.infrastructure.persistence.hackathon.HackathonRepository campaigns) {
		this.directory = directory;
		this.campaigns = campaigns;
		this.security = security;
		this.judges = judges;
	}

	@GetMapping("/api/v1/profiles/me/judge-assignments")
	public List<UUID> getAssignments(@AuthenticationPrincipal UUID userId) {
		if (directory.reviewerKey(userId).isPresent()) return campaigns.findAll().stream().map(h -> h.getId()).toList();
		return judges.findAllByUserId(userId).stream().map(judge -> judge.getHackathonId()).toList();
	}

	@GetMapping("/api/v1/hackathons/{id}/access")
	public Access getAccess(@PathVariable UUID id, Authentication authentication) {
		boolean canManage = security.canManage(id, authentication);
		return new Access(canManage, canManage || security.isJudgeOrOrgManager(id, authentication));
	}

	public record Access(boolean canManage, boolean canReview) {
	}
}
