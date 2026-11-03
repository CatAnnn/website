package wtf.hackhub.application.judging;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import wtf.hackhub.domain.JudgeScore;
import wtf.hackhub.infrastructure.persistence.IdeaMutationLock;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;
import wtf.hackhub.infrastructure.persistence.idea.VotingCriteriaRepository;
import wtf.hackhub.infrastructure.persistence.judging.HackathonJudgeRepository;
import wtf.hackhub.infrastructure.persistence.judging.JudgeScoreRepository;

import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class SubmitJudgeScoreUseCase {
	private final IdeaMutationLock mutationLock;
	private final wtf.hackhub.application.idea.NominationApprovalDirectory approvalDirectory;

	private final JudgeScoreRepository scoreRepository;
	private final HackathonJudgeRepository judgeRepository;
	private final IdeaRepository ideaRepository;
	private final VotingCriteriaRepository criteriaRepository;

	public SubmitJudgeScoreUseCase(JudgeScoreRepository scoreRepository, HackathonJudgeRepository judgeRepository,
			IdeaRepository ideaRepository, VotingCriteriaRepository criteriaRepository, IdeaMutationLock mutationLock,
			wtf.hackhub.application.idea.NominationApprovalDirectory approvalDirectory) {
		this.approvalDirectory = approvalDirectory;
		this.scoreRepository = scoreRepository;
		this.judgeRepository = judgeRepository;
		this.ideaRepository = ideaRepository;
		this.mutationLock = mutationLock;
		this.criteriaRepository = criteriaRepository;
	}

	private boolean canScore(UUID campaignId, UUID userId) {
		return judgeRepository.existsByHackathonIdAndUserId(campaignId, userId)
				|| approvalDirectory.reviewerKey(userId).isPresent();
	}

	@Transactional
	public JudgeScore execute(UUID hackathonId, UUID ideaId, UUID judgeId, UUID criterionId, int score,
			String comment) {
		if (!canScore(hackathonId, judgeId)) {
			throw new NotAJudgeException(judgeId, hackathonId);
		}

		mutationLock.acquire(ideaId);
		var idea = ideaRepository.findById(ideaId).orElseThrow(() -> new IllegalArgumentException("Case not found"));
		idea.requireApprovalPublished();
		if (!hackathonId.equals(idea.getHackathonId()))
			throw new IllegalArgumentException("Case belongs to another award");
		var currentCriteria = DigitalPioneerCriteria.current(criteriaRepository.findAllByHackathonIdOrderByDisplayOrder(hackathonId));
		if (currentCriteria.stream().anyMatch(DigitalPioneerCriteria::official)
				&& (currentCriteria.size() != 3 || currentCriteria.stream().noneMatch(c -> c.getId().equals(criterionId))))
			throw new IllegalArgumentException("Use the three current award-category criteria");
		if (criterionId != null) {
			var criterion = criteriaRepository.findById(criterionId)
					.orElseThrow(() -> new IllegalArgumentException("Criterion not found"));
			if (!hackathonId.equals(criterion.getHackathonId()))
				throw new IllegalArgumentException("Criterion belongs to another award");
		} else if (!criteriaRepository.findAllByHackathonIdOrderByDisplayOrder(hackathonId).isEmpty()) {
			throw new IllegalArgumentException("A scoring criterion is required");
		}

		return scoreRepository.findByIdeaIdAndJudgeIdAndCriterionId(ideaId, judgeId, criterionId).map(existing -> {
			existing.update(score, comment);
			return scoreRepository.save(existing);
		}).orElseGet(
				() -> scoreRepository.save(new JudgeScore(hackathonId, ideaId, judgeId, criterionId, score, comment)));
	}

	public record CriterionScore(UUID criterionId, int score) {
	}

	@Transactional
	public List<JudgeScore> submitEvaluation(UUID hackathonId, UUID ideaId, UUID judgeId, List<CriterionScore> scores,
			String comment) {
		if (!canScore(hackathonId, judgeId)) {
			throw new NotAJudgeException(judgeId, hackathonId);
		}
		var criteria = DigitalPioneerCriteria.current(criteriaRepository.findAllByHackathonIdOrderByDisplayOrder(hackathonId));
		var expected = criteria.stream().map(c -> c.getId()).collect(Collectors.toSet());
		var supplied = new HashSet<UUID>();
		if (scores == null || scores.isEmpty())
			throw new IllegalArgumentException("All criteria must be scored");
		for (var score : scores) {
			if (score.criterionId() == null || !supplied.add(score.criterionId()) || score.score() < 1
					|| score.score() > 10)
				throw new IllegalArgumentException("Provide each criterion once with an integer score from 1 to 10");
		}
		if (!expected.equals(supplied))
			throw new IllegalArgumentException("All award criteria must be scored together");
		return scores.stream().map(s -> execute(hackathonId, ideaId, judgeId, s.criterionId(), s.score(), comment))
				.toList();
	}

	@Transactional
	public void deleteEvaluation(UUID hackathonId, UUID ideaId, UUID judgeId) {
		if (!canScore(hackathonId, judgeId))
			throw new NotAJudgeException(judgeId, hackathonId);
		mutationLock.acquire(ideaId);
		var idea = ideaRepository.findById(ideaId).orElseThrow(() -> new IllegalArgumentException("Case not found"));
		idea.requireApprovalPublished();
		if (!hackathonId.equals(idea.getHackathonId()))
			throw new IllegalArgumentException("Case belongs to another award");
		scoreRepository.deleteAll(scoreRepository.findAllByIdeaId(ideaId).stream()
				.filter(score -> score.getJudgeId().equals(judgeId)).toList());
	}

	public static class NotAJudgeException extends RuntimeException {
		public NotAJudgeException(UUID userId, UUID hackathonId) {
			super("User " + userId + " is not a judge for hackathon " + hackathonId);
		}
	}
}
