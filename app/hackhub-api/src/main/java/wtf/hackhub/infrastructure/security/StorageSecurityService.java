package wtf.hackhub.infrastructure.security;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.domain.TeamMember;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;
import wtf.hackhub.infrastructure.persistence.team.TeamMemberRepository;

import java.util.UUID;

/** Authorizes logical bucket + resource path before any storage operation. */
@Service
public class StorageSecurityService {
	private final TeamMemberRepository members;
	private final HackathonSecurityService hackathons;
	private final IdeaRepository ideas;
	private final wtf.hackhub.application.idea.NominationApprovalService approvals;

	public StorageSecurityService(TeamMemberRepository members, HackathonSecurityService hackathons,
			IdeaRepository ideas, wtf.hackhub.application.idea.NominationApprovalService approvals) {
		this.approvals = approvals;
		this.members = members;
		this.hackathons = hackathons;
		this.ideas = ideas;
	}

	public void requireAccess(String bucket, String path, boolean upload, Authentication auth) {
		if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof UUID userId)) {
			throw new AccessDeniedException("Authentication required");
		}
		// Reject ambiguous paths, including empty segments, traversal and encoded
		// separators.
		if (path == null || !path.matches("[A-Za-z0-9_/-]+(?:\\.[A-Za-z0-9_-]+)?") || path.contains("..")
				|| path.startsWith("/") || path.endsWith("/") || path.contains("//")) {
			throw new AccessDeniedException("Invalid resource path");
		}
		boolean admin = auth.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));
		String[] parts = path.split("/");
		int resourceParts = upload ? parts.length : parts.length - 1;
		boolean allowed = false;
		try {
			if (resourceParts == 2) {
				UUID resourceId = UUID.fromString(parts[1]);
				allowed = switch (bucket) {
					case "avatars" -> parts[0].equals("avatars") && (admin || resourceId.equals(userId));
					case "team-files" ->
						parts[0].equals("teams") && (admin || members.existsByTeamIdAndUserId(resourceId, userId));
					case "team-avatars" -> parts[0].equals("teams") && (admin || (upload
							? members.findByTeamIdAndUserId(resourceId, userId)
									.map(m -> m.getRole() == TeamMember.Role.LEADER).orElse(false)
							: members.existsByTeamIdAndUserId(resourceId, userId)));
					case "hackathon-assets" -> parts[0].equals("banners")
							&& (upload ? hackathons.canManage(resourceId, auth) : hackathons.canView(resourceId, auth));
					case "project-attachments" ->
						parts[0].equals("projects") && (admin || members.existsByTeamIdAndUserId(resourceId, userId)
								|| (!upload && canReadPublishedAttachment(path, resourceId, null, auth)));
					default -> false;
				};
			} else if (bucket.equals("project-attachments") && resourceParts == 3 && parts[0].equals("nominations")) {
				UUID campaignId = UUID.fromString(parts[1]);
				UUID ownerId = UUID.fromString(parts[2]);
				allowed = hackathons.canView(campaignId, auth)
						&& (admin || ownerId.equals(userId)
								|| (!upload && canReadPublishedAttachment(path, campaignId, ownerId, auth)));
			}
		} catch (IllegalArgumentException ignored) {
			// Malformed resource IDs never fall back to a broader permission.
		}
		if (!allowed)
			throw new AccessDeniedException("No access to this storage resource");
	}

	private boolean canReadPublishedAttachment(String key, UUID resourceId, UUID ownerId, Authentication auth) {
		return ideas.findByAttachmentKey(key).stream()
				.anyMatch(
						idea -> (idea.isApprovalPublished() && idea.getStatus() != Idea.Status.DRAFT
								|| idea.getApprovalStatus() != null && approvals.canRead(idea, (UUID) auth.getPrincipal()))
								&& (ownerId == null
										? resourceId.equals(idea.getTeamId())
										: resourceId.equals(idea.getHackathonId())
												&& ownerId.equals(idea.getCreatedBy()))
								&& hackathons.canView(idea.getHackathonId(), auth));
	}
}
