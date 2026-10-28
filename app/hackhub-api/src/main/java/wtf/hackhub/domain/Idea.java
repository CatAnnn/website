package wtf.hackhub.domain;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "ideas")
public class Idea {

	@Id
	@GeneratedValue(strategy = GenerationType.UUID)
	private UUID id;

	@Column(nullable = false)
	private String title;

	@Column(nullable = false, columnDefinition = "text")
	private String description;

	@Column(name = "hackathon_id", nullable = false)
	private UUID hackathonId;

	@Column(name = "team_id")
	private UUID teamId;

	@Column(name = "created_by", nullable = false)
	private UUID createdBy;

	@Column(nullable = false)
	private String category;

	@Column(columnDefinition = "text[]")
	private List<String> tags = new ArrayList<>();

	@Column(nullable = false)
	private int votes = 0;

	@Convert(converter = Status.StatusConverter.class)
	@Column(nullable = false)
	private Status status = Status.DRAFT;

	@Column(columnDefinition = "text[]")
	private List<String> attachments = new ArrayList<>();

	@Column(name = "repository_url")
	private String repositoryUrl;

	@Column(name = "demo_url")
	private String demoUrl;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(name = "project_attachments", columnDefinition = "jsonb")
	private String projectAttachments;

	@Column(name = "total_score", precision = 5, scale = 2)
	private BigDecimal totalScore = BigDecimal.ZERO;

	@Column(name = "vote_count")
	private int voteCount = 0;

	@Column(name = "approval_status")
	private String approvalStatus;
	@Column(name = "approval_head_key")
	private String approvalHeadKey;
	@Column(name = "approval_head_name")
	private String approvalHeadName;
	@Column(name = "approval_reason", columnDefinition = "text")
	private String approvalReason;
	@Column(name = "approval_reviewed_at")
	private Instant approvalReviewedAt;
	@Column(name = "approval_reviewer_name")
	private String approvalReviewerName;
	@Column(name = "approval_version", nullable = false)
	private int approvalVersion;

	@Column(name = "created_at", nullable = false, updatable = false)
	private Instant createdAt = Instant.now();

	@Column(name = "updated_at", nullable = false)
	private Instant updatedAt = Instant.now();

	public enum Status {
		DRAFT, SUBMITTED, IN_PROGRESS, COMPLETED;

		public String toDbValue() {
			return name().toLowerCase().replace("_", "-");
		}

		public static Status fromDbValue(String value) {
			return valueOf(value.toUpperCase().replace("-", "_"));
		}

		@jakarta.persistence.Converter(autoApply = true)
		public static class StatusConverter implements jakarta.persistence.AttributeConverter<Status, String> {
			@Override
			public String convertToDatabaseColumn(Status status) {
				return status == null ? null : status.toDbValue();
			}

			@Override
			public Status convertToEntityAttribute(String value) {
				return value == null ? null : Status.fromDbValue(value);
			}
		}
	}

	protected Idea() {
	}

	public Idea(String title, String description, UUID hackathonId, UUID teamId, UUID createdBy, String category) {
		this.title = title;
		this.description = description;
		this.hackathonId = hackathonId;
		this.teamId = teamId;
		this.createdBy = createdBy;
		this.category = category;
	}

	@PreUpdate
	void onUpdate() {
		this.updatedAt = Instant.now();
	}

	public void update(String title, String description, String category, List<String> tags, Status status,
			String repositoryUrl, String demoUrl, String projectAttachments) {
		this.title = title;
		this.description = description;
		this.category = category;
		this.tags = tags;
		this.status = status;
		this.repositoryUrl = repositoryUrl;
		this.demoUrl = demoUrl;
		this.projectAttachments = projectAttachments;
	}

	public void updateScore(BigDecimal totalScore, int voteCount) {
		this.totalScore = totalScore;
		this.voteCount = voteCount;
	}

	public boolean isApprovalPublished() {
		return approvalStatus == null || "approved".equals(approvalStatus);
	}

	public void requireApprovalPublished() {
		if (!isApprovalPublished())
			throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND);
	}

	public void submitForApproval(String headKey, String headName) {
		approvalStatus = "pending";
		approvalHeadKey = headKey;
		approvalHeadName = headName;
		approvalReason = null;
		approvalReviewedAt = null;
		approvalReviewerName = null;
		approvalVersion++;
	}

	public void decideApproval(String decision, String reason, String reviewerName) {
		if (!"pending".equals(approvalStatus) || !("approved".equals(decision) || "rejected".equals(decision)))
			throw new IllegalArgumentException("This nomination is no longer awaiting approval");
		approvalStatus = decision;
		approvalReason = reason;
		approvalReviewedAt = Instant.now();
		approvalReviewerName = reviewerName;
		approvalVersion++;
	}

	public String getApprovalStatus() { return approvalStatus; }
	public String getApprovalHeadKey() { return approvalHeadKey; }
	public String getApprovalHeadName() { return approvalHeadName; }
	public String getApprovalReason() { return approvalReason; }
	public Instant getApprovalReviewedAt() { return approvalReviewedAt; }
	public String getApprovalReviewerName() { return approvalReviewerName; }
	public int getApprovalVersion() { return approvalVersion; }

	public UUID getId() {
		return id;
	}
	public String getTitle() {
		return title;
	}
	public String getDescription() {
		return description;
	}
	public UUID getHackathonId() {
		return hackathonId;
	}
	public UUID getTeamId() {
		return teamId;
	}
	public UUID getCreatedBy() {
		return createdBy;
	}
	public String getCategory() {
		return category;
	}
	public List<String> getTags() {
		return tags;
	}
	public int getVotes() {
		return votes;
	}
	public Status getStatus() {
		return status;
	}
	public List<String> getAttachments() {
		return attachments;
	}
	public String getRepositoryUrl() {
		return repositoryUrl;
	}
	public String getDemoUrl() {
		return demoUrl;
	}
	public String getProjectAttachments() {
		return projectAttachments;
	}
	public BigDecimal getTotalScore() {
		return totalScore;
	}
	public int getVoteCount() {
		return voteCount;
	}
	public Instant getCreatedAt() {
		return createdAt;
	}
	public Instant getUpdatedAt() {
		return updatedAt;
	}
}
