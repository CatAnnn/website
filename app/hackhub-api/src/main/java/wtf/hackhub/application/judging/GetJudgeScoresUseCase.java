package wtf.hackhub.application.judging;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import wtf.hackhub.domain.Hackathon;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.domain.JudgeScore;
import wtf.hackhub.domain.Team;
import wtf.hackhub.domain.VotingCriteria;
import wtf.hackhub.infrastructure.persistence.hackathon.HackathonRepository;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;
import wtf.hackhub.infrastructure.persistence.idea.IdeaScoreRepository;
import wtf.hackhub.infrastructure.persistence.idea.VotingCriteriaRepository;
import wtf.hackhub.infrastructure.persistence.judging.JudgeScoreRepository;
import wtf.hackhub.infrastructure.persistence.team.TeamRepository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class GetJudgeScoresUseCase {

	private final JudgeScoreRepository judgeScoreRepository;
	private final IdeaRepository ideaRepository;
	private final IdeaScoreRepository ideaScoreRepository;
	private final HackathonRepository hackathonRepository;
	private final TeamRepository teamRepository;
	private final VotingCriteriaRepository criteriaRepository;

	public GetJudgeScoresUseCase(JudgeScoreRepository judgeScoreRepository, IdeaRepository ideaRepository,
			IdeaScoreRepository ideaScoreRepository, HackathonRepository hackathonRepository,
			TeamRepository teamRepository, VotingCriteriaRepository criteriaRepository) {
		this.judgeScoreRepository = judgeScoreRepository;
		this.ideaRepository = ideaRepository;
		this.ideaScoreRepository = ideaScoreRepository;
		this.hackathonRepository = hackathonRepository;
		this.teamRepository = teamRepository;
		this.criteriaRepository = criteriaRepository;
	}

	@Transactional(readOnly = true)
	public List<JudgeScore> getScoresForHackathon(UUID hackathonId, UUID requestingUserId, boolean isManager) {
		if (isManager) {
			return judgeScoreRepository.findAllByHackathonId(hackathonId);
		}
		return judgeScoreRepository.findAllByHackathonIdAndJudgeId(hackathonId, requestingUserId);
	}

	@Transactional(readOnly = true)
	public List<ScoreSummary> getSummary(UUID hackathonId) {
		Hackathon hackathon = hackathonRepository.findById(hackathonId)
				.orElseThrow(() -> new HackathonNotFoundException(hackathonId));

		List<Idea> ideas = ideaRepository.findAllByHackathonId(hackathonId);
		List<JudgeScore> allJudgeScores = judgeScoreRepository.findAllByHackathonId(hackathonId);

		Map<UUID, List<JudgeScore>> judgeScoresByIdea = allJudgeScores.stream()
				.collect(Collectors.groupingBy(JudgeScore::getIdeaId));

		List<VotingCriteria> criteria = DigitalPioneerCriteria.current(criteriaRepository.findAllByHackathonIdOrderByDisplayOrder(hackathonId));
		var communityByIdea = ideaScoreRepository.summarizeByHackathon(hackathonId).stream()
				.collect(Collectors.toMap(IdeaScoreRepository.CommunitySummary::getIdeaId, summary -> summary));
		var teamIds = ideas.stream().map(Idea::getTeamId).filter(java.util.Objects::nonNull).distinct().toList();
		Map<UUID, String> teamNames = teamIds.isEmpty() ? Map.of() : teamRepository.findAllById(teamIds).stream()
				.collect(Collectors.toMap(Team::getId, Team::getName));
		int panelWeight = hackathon.getPanelWeight();
		int communityWeight = 100 - panelWeight;

		List<ScoreSummary> summaries = new ArrayList<>();

		for (Idea idea : ideas) {
			List<JudgeScore> panelScores = judgeScoresByIdea.getOrDefault(idea.getId(), List.of());
			int judgeCount = completedJudgeCount(panelScores, criteria);
			BigDecimal panelScore = judgeCount == 0 ? null : weightedPanelScore(panelScores, criteria, idea);

			var community = communityByIdea.get(idea.getId());
			int communityVoterCount = community == null ? 0 : community.getVoterCount();
			BigDecimal communityScore = community == null ? BigDecimal.ZERO : community.getWeightedScore();

			BigDecimal blendedScore = switch (hackathon.getJudgingMode()) {
				case PANEL -> panelScore;
				case COMMUNITY -> communityScore;
				case BLENDED -> (panelScore == null ? BigDecimal.ZERO : panelScore).multiply(BigDecimal.valueOf(panelWeight))
						.divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP)
						.add(communityScore.multiply(BigDecimal.valueOf(communityWeight))
								.divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP))
						.setScale(2, RoundingMode.HALF_UP);
			};

			String teamName = idea.getTeamId() == null
					? null
					: teamNames.get(idea.getTeamId());

			summaries.add(new ScoreSummary(idea.getId(), idea.getTitle(), panelScore, communityScore, blendedScore,
					communityVoterCount, idea.getTeamId(), teamName, 0, judgeCount, idea.getVotes()));
		}

		summaries.sort(Comparator.comparing(ScoreSummary::blendedScore, Comparator.nullsLast(Comparator.reverseOrder()))
				.thenComparing(ScoreSummary::ideaTitle).thenComparing(ScoreSummary::ideaId));

		List<ScoreSummary> ranked = new ArrayList<>();
		int rank = 0;
		BigDecimal previousScore = null;
		for (int i = 0; i < summaries.size(); i++) {
			ScoreSummary s = summaries.get(i);
			if (s.blendedScore() != null && (previousScore == null || previousScore.compareTo(s.blendedScore()) != 0)) rank = i + 1;
			previousScore = s.blendedScore();
			ranked.add(new ScoreSummary(s.ideaId(), s.ideaTitle(), s.panelScore(), s.communityScore(), s.blendedScore(),
					s.communityVoterCount(), s.teamId(), s.teamName(), s.blendedScore() == null ? 0 : rank, s.judgeCount(), s.voteCount()));
		}
		return ranked;
	}

	static int completedJudgeCount(List<JudgeScore> scores, List<VotingCriteria> criteria) {
		var byJudge = scores.stream().collect(Collectors.groupingBy(JudgeScore::getJudgeId));
		return (int) byJudge.values().stream().filter(judgeScores -> criteria.stream().allMatch(c ->
				judgeScores.stream().anyMatch(s -> c.getId().equals(s.getCriterionId())))).count();
	}

	static BigDecimal weightedPanelScore(List<JudgeScore> scores, List<VotingCriteria> criteria) {
		return weightedPanelScore(scores, criteria, null);
	}

	static BigDecimal weightedPanelScore(List<JudgeScore> scores, List<VotingCriteria> criteria, Idea idea) {
		if (criteria.isEmpty()) {
			return BigDecimal.valueOf(scores.stream().mapToInt(JudgeScore::getScore).average().orElse(0))
					.setScale(2, RoundingMode.HALF_UP);
		}
		int weight = criteria.stream().mapToInt(c -> idea == null ? c.getWeight() : DigitalPioneerCriteria.weight(idea, c)).sum();
		if (weight <= 0) return BigDecimal.ZERO;
		var byJudge = scores.stream().collect(Collectors.groupingBy(JudgeScore::getJudgeId));
		BigDecimal total = BigDecimal.ZERO;
		int completed = 0;
		for (var judgeScores : byJudge.values()) {
			var byCriterion = judgeScores.stream().filter(s -> s.getCriterionId() != null)
					.collect(Collectors.toMap(JudgeScore::getCriterionId, JudgeScore::getScore, (a, b) -> b));
			if (!criteria.stream().allMatch(c -> byCriterion.containsKey(c.getId()))) continue;
			BigDecimal weighted = criteria.stream().map(c -> BigDecimal.valueOf((long) byCriterion.get(c.getId()) * (idea == null ? c.getWeight() : DigitalPioneerCriteria.weight(idea, c))))
					.reduce(BigDecimal.ZERO, BigDecimal::add).divide(BigDecimal.valueOf(weight), 8, RoundingMode.HALF_UP);
			total = total.add(weighted);
			completed++;
		}
		return completed == 0 ? BigDecimal.ZERO : total.divide(BigDecimal.valueOf(completed), 2, RoundingMode.HALF_UP);
	}

	public record ScoreSummary(UUID ideaId, String ideaTitle, BigDecimal panelScore, BigDecimal communityScore,
			BigDecimal blendedScore, int communityVoterCount, UUID teamId, String teamName, int rank, int judgeCount, int voteCount) {
	}

	public static class HackathonNotFoundException extends RuntimeException {
		public HackathonNotFoundException(UUID id) {
			super("Hackathon not found: " + id);
		}
	}
}
