package wtf.hackhub.application.judging;

import wtf.hackhub.domain.AwardTrack;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.domain.VotingCriteria;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

/** Stable scoring slots; their labels and weights belong to the nomination's track. */
public final class DigitalPioneerCriteria {
	private DigitalPioneerCriteria() { }
	public static final String PREFIX = "DPA track criterion ";

	public static List<VotingCriteria> template(UUID campaignId) {
		return IntStream.range(0, 3).mapToObj(i -> new VotingCriteria(campaignId, PREFIX + (i + 1),
				"Use the corresponding Individual or Team award-category criterion. Collaboration weights are 30/35/35; Customer Values and Innovation weights are 40/30/30.",
				i == 0 ? 40 : 30, i)).toList();
	}

	public static boolean official(VotingCriteria criterion) {
		return IntStream.rangeClosed(1, 3).anyMatch(i -> (PREFIX + i).equals(criterion.getName()));
	}

	public static List<VotingCriteria> current(List<VotingCriteria> criteria) {
		var slots = criteria.stream().filter(DigitalPioneerCriteria::official)
				.sorted(Comparator.comparing(VotingCriteria::getName)).toList();
		return slots.isEmpty() ? criteria : slots;
	}

	public static int weight(Idea idea, VotingCriteria criterion) {
		if (!official(criterion)) return criterion.getWeight();
		boolean first = (PREFIX + "1").equals(criterion.getName());
		return "Collaboration to Win".equals(AwardTrack.normalize(idea.getCategory(), idea.getTags()))
				? (first ? 30 : 35) : (first ? 40 : 30);
	}
}
