package wtf.hackhub.application.idea;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import wtf.hackhub.domain.Hackathon;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.domain.Profile;
import wtf.hackhub.infrastructure.persistence.IdeaMutationLock;
import wtf.hackhub.infrastructure.persistence.auth.ProfileRepository;
import wtf.hackhub.infrastructure.persistence.hackathon.HackathonRepository;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;
import wtf.hackhub.infrastructure.persistence.judging.JudgeScoreRepository;
import wtf.hackhub.infrastructure.persistence.organization.OrganizationMemberRepository;
import wtf.hackhub.infrastructure.persistence.team.TeamMemberRepository;
import wtf.hackhub.infrastructure.persistence.team.TeamRepository;

import java.util.List;
import java.util.UUID;

@Service
public class SubmitIdeaUseCase {
	private final IdeaMutationLock mutationLock;
	private final wtf.hackhub.infrastructure.storage.NominationPdfValidator pdfValidator;
	private final wtf.hackhub.application.team.CreateTeamUseCase createTeam;
	private final NomineeDirectory nomineeDirectory;
	private final NominationApprovalDirectory approvalDirectory;
	private final NominationApprovalService approvalService;

	private final IdeaRepository ideaRepository;
	private final JudgeScoreRepository judgeScoreRepository;
	private final ProfileRepository profileRepository;
	private final HackathonRepository hackathonRepository;
	private final TeamRepository teamRepository;
	private final TeamMemberRepository teamMemberRepository;
	private final OrganizationMemberRepository orgMemberRepository;

	public SubmitIdeaUseCase(IdeaRepository ideaRepository, HackathonRepository hackathonRepository,
			TeamRepository teamRepository, TeamMemberRepository teamMemberRepository,
			OrganizationMemberRepository orgMemberRepository, ProfileRepository profileRepository,
			IdeaMutationLock mutationLock, JudgeScoreRepository judgeScoreRepository,
			NomineeDirectory nomineeDirectory, NominationApprovalDirectory approvalDirectory,
			NominationApprovalService approvalService,
			wtf.hackhub.infrastructure.storage.NominationPdfValidator pdfValidator,
			wtf.hackhub.application.team.CreateTeamUseCase createTeam) {
		this.pdfValidator = pdfValidator;
		this.createTeam = createTeam;
		this.approvalDirectory = approvalDirectory;
		this.approvalService = approvalService;
		this.nomineeDirectory = nomineeDirectory;
		this.ideaRepository = ideaRepository;
		this.mutationLock = mutationLock;
		this.judgeScoreRepository = judgeScoreRepository;
		this.profileRepository = profileRepository;
		this.hackathonRepository = hackathonRepository;
		this.teamRepository = teamRepository;
		this.teamMemberRepository = teamMemberRepository;
		this.orgMemberRepository = orgMemberRepository;
	}

	@Transactional
	public Idea execute(String title, String description, UUID hackathonId, UUID teamId, UUID createdBy,
			String category, List<String> tags) {
		return executeNomination(title, description, hackathonId, teamId, createdBy, category, tags, Idea.Status.DRAFT,
				null, null, null);
	}

	@Transactional
	public Idea executeNomination(String title, String description, UUID hackathonId, UUID teamId, UUID createdBy,
			String category, List<String> tags, Idea.Status status, String repositoryUrl, String demoUrl,
			String projectAttachments) {

		// Validate hackathon exists
		Hackathon hackathon = hackathonRepository.findById(hackathonId)
				.orElseThrow(() -> new IdeaHackathonNotFoundException(hackathonId));

		var requester = profileRepository.findById(createdBy)
				.orElseThrow(() -> new IdeaAccessDeniedException(null, createdBy));
		boolean teamSubmission = teamId != null || hasTeamMetadata(projectAttachments);
		if (teamId != null) requireTeamCaptain(teamId, hackathonId, createdBy);
		// The transaction lock spans the duplicate check, implicit team creation and idea insert.
		mutationLock.acquire(UUID.nameUUIDFromBytes(("nomination:" + hackathonId + ":" + createdBy + ":"
				+ teamSubmission).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
		if (ideaRepository.findByCreatedByOrderByCreatedAtDesc(createdBy).stream()
				.anyMatch(existing -> existing.getHackathonId().equals(hackathonId)
						&& (existing.getTeamId() != null || hasTeamMetadata(existing.getProjectAttachments())) == teamSubmission))
			throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT,
					"You may submit only one " + (teamSubmission ? "team" : "individual") + " nomination per award. Edit your existing nomination.");
		boolean employeeSubmission = teamSubmission || requester.getRole() == Profile.Role.PARTICIPANT
				|| approvalDirectory.allowsSelfApproval(createdBy);
		var employee = employeeSubmission ? approvalDirectory.requireEmployee(createdBy) : null;

		// Validate user is org member (if hackathon has an org)
		if (hackathon.getOrganizationId() != null
				&& !orgMemberRepository.existsByOrganizationIdAndUserId(hackathon.getOrganizationId(), createdBy)) {
			throw new IdeaAccessDeniedException(null, createdBy);
		}

		tags = normalizeTags(tags);
		validateNominee(projectAttachments, createdBy);
		projectAttachments = employeeSubmission
				? employeeMetadata(projectAttachments, employee, createdBy, hackathonId)
				: nomineeDirectory.enrich(projectAttachments, true);
		if (teamSubmission) {
			var metadata = requireTeamMetadata(projectAttachments, category);
			title = metadata.path("projectName").asText();
			description = teamDescription(metadata);
			projectAttachments = teamDisplayMetadata(projectAttachments);
			if (teamId == null) teamId = resolveTeam(hackathonId, createdBy, title);
		} else validateIndividualDocuments(projectAttachments, hackathonId, createdBy);
		Idea idea = new Idea(title, description, hackathonId, teamId, createdBy, category);
		idea.update(title, description, category, tags == null ? List.of() : tags,
				employeeSubmission ? Idea.Status.SUBMITTED : status == null ? Idea.Status.DRAFT : status, repositoryUrl, demoUrl, projectAttachments);
		if (employeeSubmission) {
			idea.submitForApproval(approvalDirectory.headKey(employee), employee.nominatingHead());
			idea = ideaRepository.saveAndFlush(idea);
			approvalService.record(idea, createdBy, "submitted", null);
			return idea;
		}
		return ideaRepository.save(idea);
	}

	@Transactional
	public Idea update(UUID ideaId, UUID requestingUserId, String title, String description, String category,
			List<String> tags, Idea.Status status, String repositoryUrl, String demoUrl, String projectAttachments) {
		return update(ideaId, requestingUserId, title, description, category, tags, status, repositoryUrl, demoUrl,
				projectAttachments, null);
	}

	@Transactional
	public Idea update(UUID ideaId, UUID requestingUserId, String title, String description, String category,
			List<String> tags, Idea.Status status, String repositoryUrl, String demoUrl, String projectAttachments,
			Integer approvalVersion) {
		mutationLock.acquire(ideaId);
		Idea idea = ideaRepository.findById(ideaId)
				.orElseThrow(() -> new VoteIdeaUseCase.IdeaNotFoundException(ideaId));
		if (!idea.getCreatedBy().equals(requestingUserId)) {
			throw new IdeaAccessDeniedException(ideaId, requestingUserId);
		}
		boolean teamSubmission = idea.getTeamId() != null && hasTeamMetadata(idea.getProjectAttachments());
		if (idea.getTeamId() != null)
			requireTeamCaptain(idea.getTeamId(), idea.getHackathonId(), requestingUserId);
		if (!teamSubmission) rejectTeamMetadata(projectAttachments);
		if (!java.util.Objects.equals(idea.getCategory(), category))
			throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT,
					"The award category cannot change after a nomination has been created.");
		boolean employeeSubmission = idea.getApprovalStatus() != null;
		if (employeeSubmission && (approvalVersion == null || approvalVersion != idea.getApprovalVersion()
				|| "approved".equals(idea.getApprovalStatus())))
			throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT,
					"The nomination changed or is already approved. Refresh before editing.");
		var employee = employeeSubmission ? approvalDirectory.requireEmployee(requestingUserId) : null;
		tags = normalizeTags(tags);
		validateNominee(projectAttachments, requestingUserId);
		projectAttachments = employeeSubmission
				? employeeMetadata(projectAttachments, employee, requestingUserId, idea.getHackathonId())
				: nomineeDirectory.enrich(projectAttachments, true);
		if (teamSubmission) {
			var metadata = requireTeamMetadata(projectAttachments, category);
			title = metadata.path("projectName").asText();
			description = teamDescription(metadata);
			projectAttachments = teamDisplayMetadata(projectAttachments);
		} else if (idea.getTeamId() == null) validateIndividualDocuments(projectAttachments, idea.getHackathonId(), requestingUserId);
		if (idea.getVotes() > 0 || !judgeScoreRepository.findAllByIdeaId(ideaId).isEmpty()) {
			Idea proposed = new Idea(title, description, idea.getHackathonId(), idea.getTeamId(), idea.getCreatedBy(),
					category);
			proposed.update(title, description, category, tags, idea.getStatus(), repositoryUrl, demoUrl,
					projectAttachments);
			if (!wtf.hackhub.domain.AwardTrack.normalize(idea.getCategory(), idea.getTags())
					.equals(wtf.hackhub.domain.AwardTrack.normalize(category, tags))
					|| !idea.getCategory().equalsIgnoreCase(category)
					|| !VoteIdeaUseCase.nomineeId(idea).equals(VoteIdeaUseCase.nomineeId(proposed))) {
				throw new IllegalArgumentException(
						"Track and nominee cannot change after voting or committee scoring has started");
			}
		}
		Idea.Status resolvedStatus = employeeSubmission ? Idea.Status.SUBMITTED : status != null ? status : idea.getStatus();
		idea.update(title, description, category, tags, resolvedStatus, repositoryUrl, demoUrl, projectAttachments);
		if (employeeSubmission) {
			idea.submitForApproval(approvalDirectory.headKey(employee), employee.nominatingHead());
			approvalService.record(idea, requestingUserId, "submitted", null);
		}
		return ideaRepository.save(idea);
	}

	private String employeeMetadata(String attachments, NominationApprovalDirectory.Employee employee,
			UUID userId, UUID hackathonId) {
		try {
			var mapper = new ObjectMapper();
			var items = attachments == null ? mapper.createArrayNode() : mapper.readTree(attachments);
			if (!items.isArray()) throw new IllegalArgumentException("Nomination attachments must be an array");
			com.fasterxml.jackson.databind.node.ObjectNode nomination = null;
			for (var item : items) {
				if ("nomination".equals(item.path("type").asText())) {
					if (!userId.toString().equals(item.path("nomineeUserId").asText()))
						throw new IdeaAccessDeniedException(null, userId);
					nomination = (com.fasterxml.jackson.databind.node.ObjectNode) item;
				}
				String key = item.path("storageKey").asText("");
				if (!key.isBlank() && !key.startsWith("nominations/" + hackathonId + "/" + userId + "/"))
					throw new IllegalArgumentException("Only your own nomination attachments may be submitted");
			}
			if (nomination == null)
				nomination = ((com.fasterxml.jackson.databind.node.ArrayNode) items).addObject().put("type", "nomination")
						.put("nomineeUserId", userId.toString());
			String name = employee.name();
			String orgUnit = employee.orgUnit();
			if (name.isBlank() || orgUnit.isBlank()) {
				var profile = profileRepository.findById(userId)
						.orElseThrow(() -> new IdeaAccessDeniedException(null, userId));
				if (name.isBlank()) name = profile.getName();
				if (orgUnit.isBlank()) orgUnit = profile.getOrgCode();
			}
			nomination.put("name", name).put("nomineeOrgCode", orgUnit)
					.put("employeeEmail", employee.email()).put("nominatingHead", employee.nominatingHead());
			return items.toString();
		} catch (JsonProcessingException ex) {
			throw new IllegalArgumentException("Invalid nomination attachments");
		}
	}

	private UUID resolveTeam(UUID campaignId, UUID userId, String projectName) {
		for (var membership : teamMemberRepository.findAllByUserId(userId)) {
			var team = teamRepository.findById(membership.getTeamId()).orElseThrow();
			if (!team.getHackathonId().equals(campaignId)) continue;
			requireTeamCaptain(team.getId(), campaignId, userId);
			return team.getId();
		}
		return createTeam.execute(projectName, "", campaignId, userId).getId();
	}

	private void validateIndividualDocuments(String attachments, UUID campaignId, UUID ownerId) {
		for (var item : attachmentItems(attachments)) {
			if (!"document".equals(item.path("type").asText())) continue;
			String key = item.path("storageKey").asText();
			if (!key.startsWith("nominations/" + campaignId + "/" + ownerId + "/")
					|| !key.matches("[A-Za-z0-9_/-]+\\.pdf") || key.contains("..") || key.contains("//"))
				throw new IllegalArgumentException("Upload your own PDF attachment (up to 10 MB).");
			pdfValidator.validate(key);
		}
	}

	private void requireTeamCaptain(UUID teamId, UUID campaignId, UUID userId) {
		var team = teamRepository.findById(teamId).orElseThrow(() -> new IdeaTeamNotFoundException(teamId));
		if (!team.getHackathonId().equals(campaignId))
			throw new IdeaTeamHackathonMismatchException(teamId, campaignId);
		if (!team.getCreatedBy().equals(userId) || teamMemberRepository.findByTeamIdAndUserId(teamId, userId)
				.filter(member -> member.getRole() == wtf.hackhub.domain.TeamMember.Role.LEADER).isEmpty())
			throw new IdeaAccessDeniedException(null, userId);
	}

	private static com.fasterxml.jackson.databind.JsonNode attachmentItems(String attachments) {
		try {
			var items = new ObjectMapper().readTree(attachments == null || attachments.isBlank() ? "[]" : attachments);
			if (items == null || !items.isArray())
				throw new IllegalArgumentException("Nomination attachments must be an array");
			return items;
		} catch (JsonProcessingException ex) {
			throw new IllegalArgumentException("Invalid nomination attachments");
		}
	}

	private static boolean hasTeamMetadata(String attachments) {
		for (var item : attachmentItems(attachments))
			if ("nomination".equals(item.path("type").asText())
					&& "team".equals(item.path("nominationType").asText())) return true;
		return false;
	}

	private static void rejectTeamMetadata(String attachments) {
		if (hasTeamMetadata(attachments))
			throw new IllegalArgumentException("A team nomination must belong to its original team");
	}

	private static com.fasterxml.jackson.databind.JsonNode requireTeamMetadata(String attachments, String category) {
		if (!List.of("Customer Values", "Innovation Breakthrough", "Collaboration to Win").contains(category))
			throw new IllegalArgumentException("Select an award category");
		com.fasterxml.jackson.databind.JsonNode nomination = null;
		boolean photo = false;
		for (var item : attachmentItems(attachments)) {
			if ("nomination".equals(item.path("type").asText())) nomination = item;
			else {
				String key = item.path("storageKey").asText();
				if (key.isBlank() || key.contains("..") || key.contains("//")
						|| !key.matches("[A-Za-z0-9_/-]+(?:\\.[A-Za-z0-9_-]+)?"))
					throw new IllegalArgumentException("Upload team attachments to your nomination storage");
				if ("screenshot".equals(item.path("type").asText())
						&& key.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(png|jpe?g|webp|gif)")) photo = true;
			}
		}
		if (nomination == null || !"team".equals(nomination.path("nominationType").asText()))
			throw new IllegalArgumentException("Team nomination details are required");
		for (String field : List.of("projectName", "coreTeamMembers", "achievementSummary", "teamAchievementImpact", "cultureDemonstration"))
			if (!nomination.path(field).isTextual() || nomination.path(field).asText().isBlank())
				throw new IllegalArgumentException("Team nomination field is required: " + field);
		String coreMembers = nomination.path("coreTeamMembers").asText();
		if (coreMembers.contains("；") || coreMembers.contains("\n") || coreMembers.contains("\r")
				|| java.util.Arrays.stream(coreMembers.split(";", -1)).anyMatch(String::isBlank))
			throw new IllegalArgumentException("Enter Outlook names separated by semicolons (;), without empty names");
		if (nomination.path("projectName").asText().length() > 255)
			throw new IllegalArgumentException("Project Name must not exceed 255 characters");
		if (nomination.path("achievementSummary").asText().strip().split("(?U)\\s+").length > 200)
			throw new IllegalArgumentException("Achievement Summary must not exceed 200 words");
		if (!photo) throw new IllegalArgumentException("Team Photo is required");
		return nomination;
	}

	private static String teamDisplayMetadata(String attachments) {
		var items = attachmentItems(attachments);
		for (var item : items) {
			if (!"nomination".equals(item.path("type").asText())) continue;
			var nomination = (com.fasterxml.jackson.databind.node.ObjectNode) item;
			nomination.put("nominatorName", nomination.path("name").asText());
			nomination.put("name", nomination.path("projectName").asText());
		}
		return items.toString();
	}

	private static String teamDescription(com.fasterxml.jackson.databind.JsonNode nomination) {
		return "Achievement Summary\n" + nomination.path("achievementSummary").asText()
				+ "\n\nDetails of Your Team Achievement in 2026 and Business Impact\n"
				+ nomination.path("teamAchievementImpact").asText()
				+ "\n\nHow you demonstrate BD China culture (especially on you applied category) ?\n"
				+ nomination.path("cultureDemonstration").asText();
	}

	private static List<String> normalizeTags(List<String> tags) {
		if (tags == null)
			return List.of();
		List<String> normalized = tags.stream().filter(java.util.Objects::nonNull)
				.flatMap(tag -> java.util.Arrays.stream(tag.split("[,，、]")))
				.map(String::strip).filter(tag -> !tag.isEmpty()).distinct().toList();
		if (normalized.size() > 5)
			throw new IllegalArgumentException("Add up to 5 tags, separated by 、, ， or commas (,).");
		return normalized;
	}

	private void validateNominee(String attachments, UUID requesterId) {
		if (attachments == null || attachments.isBlank())
			return;
		try {
			var items = new ObjectMapper().readTree(attachments);
			if (items == null || !items.isArray())
				throw new IllegalArgumentException("Nomination attachments must be an array");
			int nominations = 0;
			for (var item : items) {
				if (!"nomination".equals(item.path("type").asText()))
					continue;
				if (++nominations > 1)
					throw new IllegalArgumentException("Only one nominee is allowed");
				UUID nomineeId = UUID.fromString(item.path("nomineeUserId").asText());
				if (!profileRepository.existsById(nomineeId))
					throw new IllegalArgumentException("Nominee profile not found");
				if (!nomineeId.equals(requesterId)) {
					var requester = profileRepository.findById(requesterId)
							.orElseThrow(() -> new IdeaAccessDeniedException(null, requesterId));
					if (requester.getRole() != Profile.Role.ADMIN && requester.getRole() != Profile.Role.MANAGER)
						throw new IdeaAccessDeniedException(null, requesterId);
				}
			}
		} catch (JsonProcessingException ex) {
			throw new IllegalArgumentException("Invalid nomination attachments");
		}
	}

	@Transactional
	public void delete(UUID ideaId, UUID requestingUserId) {
		deleteMany(List.of(ideaId), requestingUserId);
	}

	@Transactional
	public void deleteMany(List<UUID> ideaIds, UUID requestingUserId) {
		var requester = profileRepository.findById(requestingUserId)
				.orElseThrow(() -> new IdeaAccessDeniedException(null, requestingUserId));
		if (requester.getRole() != Profile.Role.ADMIN) {
			throw new IdeaAccessDeniedException(null, requestingUserId);
		}
		if (ideaIds == null || ideaIds.isEmpty() || ideaIds.stream().anyMatch(java.util.Objects::isNull)) {
			throw new IllegalArgumentException("Select at least one nomination to delete.");
		}
		// Stable lock order prevents overlapping batches from deadlocking with each other.
		var ids = ideaIds.stream().distinct().sorted().toList();
		ids.forEach(mutationLock::acquire);
		var ideas = ids.stream().map(id -> ideaRepository.findById(id)
				.orElseThrow(() -> new VoteIdeaUseCase.IdeaNotFoundException(id))).toList();
		// Existing foreign keys cascade votes, comments and scores in the same transaction.
		ideaRepository.deleteAll(ideas);
		ideaRepository.flush();
	}

	public static class IdeaAccessDeniedException extends RuntimeException {
		public IdeaAccessDeniedException(UUID id, UUID userId) {
			super("User " + userId + " does not have permission to submit or edit idea " + id);
		}
	}
	public static class IdeaHackathonNotFoundException extends RuntimeException {
		public IdeaHackathonNotFoundException(UUID id) {
			super("Hackathon not found: " + id);
		}
	}
	public static class IdeaTeamNotFoundException extends RuntimeException {
		public IdeaTeamNotFoundException(UUID id) {
			super("Team not found: " + id);
		}
	}
	public static class IdeaTeamHackathonMismatchException extends RuntimeException {
		public IdeaTeamHackathonMismatchException(UUID teamId, UUID hackathonId) {
			super("Team " + teamId + " does not belong to hackathon " + hackathonId);
		}
	}
}
