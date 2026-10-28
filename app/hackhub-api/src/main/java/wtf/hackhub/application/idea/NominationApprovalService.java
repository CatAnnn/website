package wtf.hackhub.application.idea;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.domain.Profile;
import wtf.hackhub.infrastructure.persistence.IdeaMutationLock;
import wtf.hackhub.infrastructure.persistence.auth.ProfileRepository;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;

import java.util.List;
import java.util.UUID;

@Service
public class NominationApprovalService {
	private final NominationApprovalDirectory directory;
	private final IdeaRepository ideas;
	private final ProfileRepository profiles;
	private final IdeaMutationLock mutationLock;
	private final JdbcTemplate jdbc;
	public NominationApprovalService(NominationApprovalDirectory directory, IdeaRepository ideas,
			ProfileRepository profiles, IdeaMutationLock mutationLock, JdbcTemplate jdbc) {
		this.directory = directory;
		this.ideas = ideas;
		this.profiles = profiles;
		this.mutationLock = mutationLock;
		this.jdbc = jdbc;
	}
	public record Eligibility(boolean canSubmit, boolean canReview, String nominatingHead, String message) { }
	public record Selection(UUID id, int version) { }
	@Transactional(readOnly = true)
	public Eligibility eligibility(UUID userId) {
		boolean canReview = directory.reviewerKey(userId).isPresent();
		boolean privileged = profiles.findById(userId).map(p -> p.getRole() != Profile.Role.PARTICIPANT).orElse(false);
		var employee = directory.employee(userId);
		try {
			if (!privileged) directory.requireEmployee(userId);
			return new Eligibility(true, canReview, employee.map(NominationApprovalDirectory.Employee::nominatingHead).orElse(null), null);
		} catch (IllegalArgumentException ex) {
			return new Eligibility(false, canReview, employee.map(NominationApprovalDirectory.Employee::nominatingHead).orElse(null), ex.getMessage());
		}
	}
	@Transactional(readOnly = true)
	public List<Idea> mine(UUID userId) { return ideas.findByCreatedByOrderByCreatedAtDesc(userId); }
	@Transactional(readOnly = true)
	public List<Idea> assigned(UUID userId) {
		String key = directory.reviewerKey(userId).orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN));
		boolean allowSelfApproval = directory.allowsSelfApproval(userId);
		return ideas.findByApprovalHeadKeyOrderByCreatedAtDesc(key).stream()
				.filter(i -> !i.getCreatedBy().equals(userId) || allowSelfApproval).toList();
	}
	public boolean canRead(Idea idea, UUID userId) {
		return idea.isApprovalPublished() || (userId != null && (idea.getCreatedBy().equals(userId)
				|| directory.reviewerKey(userId).map(key -> key.equals(idea.getApprovalHeadKey())).orElse(false)));
	}
	@Transactional
	public List<Idea> decide(UUID userId, List<Selection> selections, String decision, String reason) {
		if (!("approved".equals(decision) || "rejected".equals(decision)))
			throw new IllegalArgumentException("Choose approved or rejected");
		String comment = reason == null ? "" : reason.strip();
		if (comment.length() > 2000 || ("rejected".equals(decision) && comment.isBlank()))
			throw new IllegalArgumentException("A rejection reason is required (up to 2000 characters)");
		if (selections == null || selections.isEmpty() || selections.size() > 200 || selections.stream().anyMatch(s -> s == null || s.id() == null))
			throw new IllegalArgumentException("Select between 1 and 200 nominations");
		var ids = selections.stream().map(Selection::id).distinct().sorted().toList();
		if (ids.size() != selections.size()) throw new IllegalArgumentException("Duplicate nominations are not allowed");
		String key = directory.reviewerKey(userId).orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN));
		boolean allowSelfApproval = directory.allowsSelfApproval(userId);
		ids.forEach(mutationLock::acquire);
		var selected = ids.stream().map(id -> ideas.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND))).toList();
		for (var idea : selected) {
			if (!key.equals(idea.getApprovalHeadKey()) || userId.equals(idea.getCreatedBy()) && !allowSelfApproval)
				throw new ResponseStatusException(HttpStatus.FORBIDDEN);
			int version = selections.stream().filter(s -> s.id().equals(idea.getId())).findFirst().orElseThrow().version();
			if (!"pending".equals(idea.getApprovalStatus()) || version != idea.getApprovalVersion())
				throw new ResponseStatusException(HttpStatus.CONFLICT, "The nomination changed. Refresh before reviewing.");
		}
		for (var idea : selected) {
			idea.decideApproval(decision, comment, idea.getApprovalHeadName());
			record(idea, userId, decision, comment);
		}
		return ideas.saveAll(selected);
	}
	public void record(Idea idea, UUID userId, String decision, String reason) {
		ideas.flush();
		jdbc.update("INSERT INTO nomination_approval_events (idea_id, actor_id, submission_version, decision, reason) VALUES (?, ?, ?, ?, ?)",
				idea.getId(), userId, idea.getApprovalVersion(), decision, reason);
	}
}
