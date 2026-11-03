package wtf.hackhub.presentation.award;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import wtf.hackhub.application.idea.NomineeDirectory;
import wtf.hackhub.application.storage.StoragePort;
import wtf.hackhub.domain.AwardTrack;
import wtf.hackhub.domain.Hackathon;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.infrastructure.persistence.hackathon.HackathonRepository;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Read-only website data; private campaigns, drafts and review scores remain
 * protected.
 */
@RestController
@RequestMapping("/api/v1/public/awards")
@Transactional(readOnly = true)
public class PublicAwardController {
	private final HackathonRepository awards;
	private final IdeaRepository ideas;
	private final NomineeDirectory nominees;
	private final StoragePort storage;
	private final ObjectMapper mapper;

	public PublicAwardController(HackathonRepository awards, IdeaRepository ideas, NomineeDirectory nominees,
			StoragePort storage, ObjectMapper mapper) {
		this.awards = awards;
		this.ideas = ideas;
		this.nominees = nominees;
		this.storage = storage;
		this.mapper = mapper;
	}

	@GetMapping
	public Page<AwardSummary> list(Pageable pageable) {
		return awards
				.findByVisibilityAndStatusNotOrderByCreatedAtDesc(Hackathon.Visibility.PUBLIC, Hackathon.Status.DRAFT,
						pageable)
				.map(h -> new AwardSummary(h.getId(), h.getTitle(), h.getStatus().name().toLowerCase()));
	}

	@GetMapping("/{id}/nominations")
	public Page<Nomination> nominations(@PathVariable UUID id, Pageable pageable) {
		var award = awards.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
		if (award.getVisibility() != Hackathon.Visibility.PUBLIC || award.getStatus() == Hackathon.Status.DRAFT)
			throw new ResponseStatusException(HttpStatus.NOT_FOUND);
		return ideas.findByHackathonIdAndStatusNotOrderByCreatedAtDesc(id, Idea.Status.DRAFT, pageable)
				.map(this::nomination);
	}

	private Nomination nomination(Idea idea) {
		String name = idea.getTitle();
		String orgCode = "";
		var images = new ArrayList<String>();
		try {
			var attachments = mapper.readTree(idea.getApprovalStatus() == null
					? nominees.enrichLegacy(idea.getProjectAttachments(), idea.getCreatedBy()) : idea.getProjectAttachments());
			for (var attachment : attachments) {
				if ("nomination".equals(attachment.path("type").asText())) {
					name = attachment.path("name").asText(name);
					orgCode = attachment.path("nomineeOrgCode").asText("");
				}
				if ("screenshot".equals(attachment.path("type").asText())) {
					String key = attachment.path("storageKey").asText("");
					String url = attachment.path("url").asText("");
					if (!key.isBlank()) {
						try {
							url = storage.presignedDownloadUrl("hackhub-project-attachments", key, 3600);
						} catch (RuntimeException ignored) {
							/* Keep the original URL if storage is unavailable. */ }
					}
					if (!url.isBlank())
						images.add(url);
				}
			}
		} catch (com.fasterxml.jackson.core.JsonProcessingException | IllegalArgumentException ignored) {
			// Legacy malformed metadata must not hide an otherwise published nomination.
		}
		if (idea.getAttachments() != null)
			images.addAll(idea.getAttachments());
		return new Nomination(idea.getId(), idea.getTitle(), idea.getDescription(), idea.getHackathonId(), name,
				orgCode, AwardTrack.normalize(idea.getCategory(), idea.getTags()), idea.getTags(), images,
				idea.getVotes(), idea.getStatus().toDbValue(), idea.getCreatedAt(), idea.getUpdatedAt(),
				idea.getRepositoryUrl(), idea.getDemoUrl(), idea.getTeamId() == null ? "individual" : "team");
	}

	public record AwardSummary(UUID id, String title, String status) {
	}
	public record Nomination(UUID id, String title, String description, UUID hackathon_id, String nominee_name,
			String nominee_org_code, String category, List<String> technologies, List<String> images, int votes,
			String status, Instant created_at, Instant submission_date, String github_url, String demo_url,
			String nomination_type) {
	}
}
