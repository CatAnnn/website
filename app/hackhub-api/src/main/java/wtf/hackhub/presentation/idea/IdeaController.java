package wtf.hackhub.presentation.idea;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import wtf.hackhub.application.idea.*;
import wtf.hackhub.domain.Comment;
import wtf.hackhub.domain.Idea;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Tag(name = "Ideas", description = "Idea CRUD, voting, comments, and scoring")
@RestController
public class IdeaController {

	private final SubmitIdeaUseCase submitIdeaUseCase;
	private final wtf.hackhub.presentation.websocket.HackathonEventPublisher events;
	private final NominationApprovalService approvalService;
	private final wtf.hackhub.infrastructure.persistence.idea.IdeaRepository ideaRepository;
	private final NomineeDirectory nomineeDirectory;
	private final GetIdeasUseCase getIdeasUseCase;
	private final VoteIdeaUseCase voteIdeaUseCase;
	private final CommentUseCase commentUseCase;
	private final ScoreIdeaUseCase scoreIdeaUseCase;

	public IdeaController(SubmitIdeaUseCase submitIdeaUseCase, GetIdeasUseCase getIdeasUseCase,
			VoteIdeaUseCase voteIdeaUseCase, CommentUseCase commentUseCase, ScoreIdeaUseCase scoreIdeaUseCase,
			NomineeDirectory nomineeDirectory, NominationApprovalService approvalService,
			wtf.hackhub.infrastructure.persistence.idea.IdeaRepository ideaRepository,
			wtf.hackhub.presentation.websocket.HackathonEventPublisher events) {
		this.events = events;
		this.approvalService = approvalService;
		this.ideaRepository = ideaRepository;
		this.nomineeDirectory = nomineeDirectory;
		this.submitIdeaUseCase = submitIdeaUseCase;
		this.getIdeasUseCase = getIdeasUseCase;
		this.voteIdeaUseCase = voteIdeaUseCase;
		this.commentUseCase = commentUseCase;
		this.scoreIdeaUseCase = scoreIdeaUseCase;
	}

	@Operation(summary = "List ideas for a hackathon")
	@ApiResponses({@ApiResponse(responseCode = "200", description = "Success"),
			@ApiResponse(responseCode = "401", description = "Not authenticated")})
	@GetMapping("/api/v1/hackathons/{hackathonId}/ideas")
	public Page<IdeaResponse> listByHackathon(@PathVariable UUID hackathonId, Pageable pageable,
			@AuthenticationPrincipal UUID userId) {
		var ideas = getIdeasUseCase.listByHackathon(hackathonId, pageable);
		var votedIds = getIdeasUseCase.votedIdeaIds(ideas.getContent().stream().map(Idea::getId).toList(), userId);
		return ideas.map(idea -> response(idea, votedIds.contains(idea.getId())));
	}

	@Operation(summary = "Submit a new idea to a hackathon")
	@ApiResponses({@ApiResponse(responseCode = "201", description = "Idea submitted"),
			@ApiResponse(responseCode = "400", description = "Validation failed"),
			@ApiResponse(responseCode = "401", description = "Not authenticated")})
	@PostMapping("/api/v1/hackathons/{hackathonId}/ideas")
	@ResponseStatus(HttpStatus.CREATED)
	public IdeaResponse create(@PathVariable UUID hackathonId, @Valid @RequestBody CreateIdeaRequest req,
			@AuthenticationPrincipal UUID userId) {
		return response(submitIdeaUseCase.executeNomination(req.title(), req.description(), hackathonId, req.teamId(),
				userId, req.category(), req.tags(), req.status(), req.repositoryUrl(), req.demoUrl(),
				req.projectAttachments()), false);
	}

	@Operation(summary = "Get an idea by ID")
	@ApiResponses({@ApiResponse(responseCode = "200", description = "Success"),
			@ApiResponse(responseCode = "401", description = "Not authenticated"),
			@ApiResponse(responseCode = "404", description = "Idea not found")})
	@GetMapping("/api/v1/ideas/{id}")
	public IdeaResponse getById(@PathVariable UUID id, @AuthenticationPrincipal UUID userId) {
		var idea = ideaRepository.findById(id).orElseThrow(() -> new VoteIdeaUseCase.IdeaNotFoundException(id));
		if (!approvalService.canRead(idea, userId))
			throw new org.springframework.web.server.ResponseStatusException(HttpStatus.NOT_FOUND);
		return response(idea, getIdeasUseCase.hasVoted(id, userId));
	}

	@Operation(summary = "Update an existing idea")
	@ApiResponses({@ApiResponse(responseCode = "200", description = "Updated"),
			@ApiResponse(responseCode = "400", description = "Validation failed"),
			@ApiResponse(responseCode = "401", description = "Not authenticated"),
			@ApiResponse(responseCode = "404", description = "Idea not found")})
	@PutMapping("/api/v1/ideas/{id}")
	public IdeaResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateIdeaRequest req,
			@AuthenticationPrincipal UUID userId) {
		Idea idea = submitIdeaUseCase.update(id, userId, req.title(), req.description(), req.category(), req.tags(),
				req.status() != null ? Idea.Status.valueOf(req.status().toUpperCase().replace("-", "_")) : null,
				req.repositoryUrl(), req.demoUrl(), req.projectAttachments(), req.approvalVersion());
		return response(idea, getIdeasUseCase.hasVoted(id, userId));
	}

	@Operation(summary = "Delete an idea")
	@ApiResponses({@ApiResponse(responseCode = "204", description = "Deleted"),
			@ApiResponse(responseCode = "401", description = "Not authenticated"),
			@ApiResponse(responseCode = "404", description = "Idea not found")})
	@DeleteMapping("/api/v1/ideas/{id}")
	@PreAuthorize("hasRole('ADMIN')")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void delete(@PathVariable UUID id, @AuthenticationPrincipal UUID userId) {
		submitIdeaUseCase.delete(id, userId);
	}

	@Operation(summary = "Delete selected nominations as an administrator")
	@PostMapping("/api/v1/ideas/batch-delete")
	@PreAuthorize("hasRole('ADMIN')")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void deleteMany(@Valid @RequestBody DeleteIdeasRequest req, @AuthenticationPrincipal UUID userId) {
		submitIdeaUseCase.deleteMany(req.ids(), userId);
	}

	public record DeleteIdeasRequest(
			@jakarta.validation.constraints.NotEmpty List<@jakarta.validation.constraints.NotNull UUID> ids) {
	}

	@Operation(summary = "Toggle a vote on an idea")
	@ApiResponses({@ApiResponse(responseCode = "200", description = "Vote toggled"),
			@ApiResponse(responseCode = "401", description = "Not authenticated"),
			@ApiResponse(responseCode = "404", description = "Idea not found")})
	@PostMapping("/api/v1/ideas/{id}/votes")
	public VoteResponse vote(@PathVariable UUID id, @AuthenticationPrincipal UUID userId) {
		VoteIdeaUseCase.Result result = voteIdeaUseCase.execute(id, userId);
		publishVote(id);
		return new VoteResponse(result.voted(), result.voteCount());
	}

	@Operation(summary = "Record the signed-in user's votes atomically")
	@PostMapping("/api/v1/me/votes")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void submitVotes(@Valid @RequestBody SubmitVotesRequest req, @AuthenticationPrincipal UUID userId) {
		voteIdeaUseCase.submit(req.ideaIds(), userId);
		req.ideaIds().stream().distinct().forEach(this::publishVote);
	}

	private void publishVote(UUID ideaId) {
		// The use case has committed; a broker outage must not turn a saved vote into a failed response.
		try { ideaRepository.findById(ideaId).ifPresent(idea -> events.publishVoteUpdate(idea.getHackathonId(), ideaId, idea.getVotes())); }
		catch (RuntimeException ignored) { /* Clients also revalidate totals over HTTP. */ }
	}

	public record SubmitVotesRequest(
			@jakarta.validation.constraints.NotEmpty List<@jakarta.validation.constraints.NotNull UUID> ideaIds) {
	}

	@Operation(summary = "Delete one voting record belonging to the signed-in user")
	@DeleteMapping("/api/v1/me/votes/{ideaId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void deleteVoteRecord(@PathVariable UUID ideaId, @AuthenticationPrincipal UUID userId) {
		voteIdeaUseCase.deleteRecord(ideaId, userId);
		publishVote(ideaId);
	}

	@Operation(summary = "Clear all votes belonging to the signed-in user")
	@DeleteMapping("/api/v1/me/votes")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void clearMyVotes(@AuthenticationPrincipal UUID userId) {
		voteIdeaUseCase.clearAll(userId);
	}

	@DeleteMapping("/api/v1/hackathons/{hackathonId}/votes")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void clearTrackVotes(@PathVariable UUID hackathonId, @RequestParam String category,
			@AuthenticationPrincipal UUID userId) {
		voteIdeaUseCase.clearTrack(hackathonId, userId, category);
	}

	@Operation(summary = "List comments on an idea")
	@ApiResponses({@ApiResponse(responseCode = "200", description = "Success"),
			@ApiResponse(responseCode = "401", description = "Not authenticated"),
			@ApiResponse(responseCode = "404", description = "Idea not found")})
	@GetMapping("/api/v1/ideas/{id}/comments")
	public List<CommentResponse> listComments(@PathVariable UUID id) {
		return commentUseCase.listForIdea(id).stream().map(CommentResponse::from).toList();
	}

	@Operation(summary = "Add a comment to an idea")
	@ApiResponses({@ApiResponse(responseCode = "201", description = "Comment added"),
			@ApiResponse(responseCode = "400", description = "Validation failed"),
			@ApiResponse(responseCode = "401", description = "Not authenticated"),
			@ApiResponse(responseCode = "404", description = "Idea not found")})
	@PostMapping("/api/v1/ideas/{id}/comments")
	@ResponseStatus(HttpStatus.CREATED)
	public CommentResponse addComment(@PathVariable UUID id, @Valid @RequestBody AddCommentRequest req,
			@AuthenticationPrincipal UUID userId) {
		return CommentResponse.from(commentUseCase.add(id, userId, req.content()));
	}

	@Operation(summary = "Submit a judge score for an idea")
	@ApiResponses({@ApiResponse(responseCode = "200", description = "Score recorded"),
			@ApiResponse(responseCode = "400", description = "Validation failed"),
			@ApiResponse(responseCode = "401", description = "Not authenticated"),
			@ApiResponse(responseCode = "404", description = "Idea or criteria not found")})
	@PostMapping("/api/v1/ideas/{id}/scores")
	public ScoreResponse score(@PathVariable UUID id, @Valid @RequestBody ScoreRequest req,
			@AuthenticationPrincipal UUID userId) {
		var s = scoreIdeaUseCase.execute(id, userId, req.criteriaId(), req.score());
		return new ScoreResponse(s.getId(), s.getIdeaId(), s.getUserId(), s.getCriteriaId(), s.getScore());
	}

	@PutMapping("/api/v1/ideas/{id}/comments/{commentId}")
	public CommentResponse updateComment(@PathVariable UUID id, @PathVariable UUID commentId,
			@Valid @RequestBody AddCommentRequest req, @AuthenticationPrincipal UUID userId) {
		return CommentResponse.from(commentUseCase.update(id, commentId, userId, req.content()));
	}

	@DeleteMapping("/api/v1/ideas/{id}/comments/{commentId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void deleteComment(@PathVariable UUID id, @PathVariable UUID commentId,
			@AuthenticationPrincipal UUID userId) {
		commentUseCase.delete(id, commentId, userId);
	}

	@GetMapping("/api/v1/me/nomination-eligibility")
	public NominationApprovalService.Eligibility eligibility(@AuthenticationPrincipal UUID userId) {
		return approvalService.eligibility(userId);
	}
	@GetMapping("/api/v1/me/nominations")
	public List<IdeaResponse> myNominations(@AuthenticationPrincipal UUID userId) {
		return approvalService.mine(userId).stream().map(i -> response(i, false)).toList();
	}
	@GetMapping("/api/v1/me/nomination-approvals")
	public List<IdeaResponse> assignedNominations(@AuthenticationPrincipal UUID userId) {
		return approvalService.assigned(userId).stream().map(i -> response(i, false)).toList();
	}
	@PostMapping("/api/v1/me/nomination-approvals")
	public List<IdeaResponse> decideNominations(@RequestBody ApprovalRequest request,
			@AuthenticationPrincipal UUID userId) {
		return approvalService.decide(userId, request.items(), request.decision(), request.reason())
				.stream().map(i -> response(i, false)).toList();
	}
	public record ApprovalRequest(List<NominationApprovalService.Selection> items, String decision, String reason) { }

	private IdeaResponse response(Idea idea, boolean voted) {
		var result = IdeaResponse.from(idea, voted);
		return new IdeaResponse(result.id(), result.title(), result.description(), result.hackathonId(),
				result.teamId(), result.createdBy(),
				wtf.hackhub.domain.AwardTrack.normalize(result.category(), result.tags()), result.tags(),
				result.votes(), result.status(), result.attachments(), result.repositoryUrl(), result.demoUrl(),
				(idea.getApprovalStatus() == null ? nomineeDirectory.enrichLegacy(result.projectAttachments(), result.createdBy())
				: result.projectAttachments()), result.totalScore(),
				result.voteCount(), result.userHasVoted(), result.createdAt(), result.updatedAt(),
				result.approvalStatus(), result.approvalReason(), result.approvalReviewedAt(), result.approvalReviewerName(),
				result.approvalVersion(), result.approvalHeadName());
	}

	// ── DTOs ──────────────────────────────────────────────────────────────────

	public record IdeaResponse(UUID id, String title, String description, UUID hackathonId, UUID teamId, UUID createdBy,
			String category, List<String> tags, int votes, String status, List<String> attachments,
			String repositoryUrl, String demoUrl, String projectAttachments, BigDecimal totalScore, int voteCount,
			boolean userHasVoted, Instant createdAt, Instant updatedAt, String approvalStatus, String approvalReason,
			Instant approvalReviewedAt, String approvalReviewerName, int approvalVersion, String approvalHeadName) {
		static IdeaResponse from(Idea i, boolean userHasVoted) {
			return new IdeaResponse(i.getId(), i.getTitle(), i.getDescription(), i.getHackathonId(), i.getTeamId(),
					i.getCreatedBy(), i.getCategory(), i.getTags(), i.getVotes(), i.getStatus().toDbValue(),
					i.getAttachments(), i.getRepositoryUrl(), i.getDemoUrl(), i.getProjectAttachments(),
					i.getTotalScore(), i.getVoteCount(), userHasVoted, i.getCreatedAt(), i.getUpdatedAt(),
					i.getApprovalStatus(), i.getApprovalReason(), i.getApprovalReviewedAt(), i.getApprovalReviewerName(),
					i.getApprovalVersion(), i.getApprovalHeadName());
		}
	}

	public record CommentResponse(UUID id, UUID ideaId, UUID userId, String content, Instant createdAt,
			Instant updatedAt) {
		static CommentResponse from(Comment c) {
			return new CommentResponse(c.getId(), c.getIdeaId(), c.getUserId(), c.getContent(), c.getCreatedAt(),
					c.getUpdatedAt());
		}
	}

	public record VoteResponse(boolean voted, long voteCount) {
	}
	public record ScoreResponse(UUID id, UUID ideaId, UUID userId, UUID criteriaId, int score) {
	}

	public record CreateIdeaRequest(@NotBlank String title, @NotBlank String description, UUID teamId,
			@NotBlank String category, List<String> tags, Idea.Status status, String repositoryUrl, String demoUrl,
			String projectAttachments) {
	}

	public record UpdateIdeaRequest(@NotBlank String title, @NotBlank String description, @NotBlank String category,
			List<String> tags, String status, String repositoryUrl, String demoUrl, String projectAttachments,
			Integer approvalVersion) {
		public UpdateIdeaRequest {
			if (tags == null)
				tags = List.of();
		}
	}

	public record AddCommentRequest(@NotBlank @jakarta.validation.constraints.Size(max = 5000) String content) {
	}

	public record ScoreRequest(UUID criteriaId, int score) {
	}
}
