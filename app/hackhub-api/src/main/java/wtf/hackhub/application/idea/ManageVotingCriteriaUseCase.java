package wtf.hackhub.application.idea;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import wtf.hackhub.domain.VotingCriteria;
import wtf.hackhub.infrastructure.persistence.idea.VotingCriteriaRepository;

import java.util.List;
import java.util.UUID;

@Service
public class ManageVotingCriteriaUseCase {

	private final VotingCriteriaRepository criteriaRepository;
	private final org.springframework.jdbc.core.JdbcTemplate jdbc;

	public ManageVotingCriteriaUseCase(VotingCriteriaRepository criteriaRepository,
			org.springframework.jdbc.core.JdbcTemplate jdbc) {
		this.jdbc = jdbc;
		this.criteriaRepository = criteriaRepository;
	}

	@Transactional(readOnly = true)
	public List<VotingCriteria> listForHackathon(UUID hackathonId) {
		return wtf.hackhub.application.judging.DigitalPioneerCriteria.current(criteriaRepository.findAllByHackathonIdOrderByDisplayOrder(hackathonId));
	}

	@Transactional
	@PreAuthorize("hasRole('ADMIN') or @hackathonSecurity.isOwnerOrOrgManager(#hackathonId, authentication)")
	public VotingCriteria create(UUID hackathonId, String name, String description, int weight, int displayOrder) {
		lockCampaign(hackathonId);
		validateWeight(hackathonId, weight, null);
		return criteriaRepository.save(new VotingCriteria(hackathonId, name, description, weight, displayOrder));
	}

	@Transactional
	@PreAuthorize("hasRole('ADMIN') or @hackathonSecurity.isOwnerOrOrgManager(#hackathonId, authentication)")
	public void delete(UUID hackathonId, UUID criteriaId) {
		lockCampaign(hackathonId);
		criteriaRepository.deleteById(criteriaId);
	}

	private void lockCampaign(UUID id) {
		jdbc.query("SELECT id FROM hackathons WHERE id=? FOR UPDATE", rs -> {
		}, id);
	}

	@Transactional
	@PreAuthorize("hasRole('ADMIN') or (hasRole('MANAGER') and @hackathonSecurity.isOwnerOrOrgManager(#hackathonId, authentication))")
	public List<VotingCriteria> applyAwardTemplate(UUID hackathonId) {
		lockCampaign(hackathonId);
		if (jdbc.queryForObject("SELECT count(*) FROM hackathons WHERE id=?", Integer.class, hackathonId) == 0)
			throw new org.springframework.web.server.ResponseStatusException(
					org.springframework.http.HttpStatus.NOT_FOUND);
		// Row locks also serialize score inserts referencing the old criteria through
		// their FK.
		jdbc.query("SELECT id FROM voting_criteria WHERE hackathon_id=? ORDER BY id FOR UPDATE", rs -> {
		}, hackathonId);
		var current = criteriaRepository.findAllByHackathonIdOrderByDisplayOrder(hackathonId);
		// Keep historical criteria and scores; new track scores use distinct stable slots.
		var template = wtf.hackhub.application.judging.DigitalPioneerCriteria.template(hackathonId);
		var missing = template.stream().filter(slot -> current.stream()
				.noneMatch(c -> c.getName().equals(slot.getName()))).toList();
		criteriaRepository.saveAll(missing);

		jdbc.update("UPDATE hackathons SET judging_mode='panel', panel_weight=100 WHERE id=?", hackathonId);
		return wtf.hackhub.application.judging.DigitalPioneerCriteria.current(criteriaRepository.findAllByHackathonIdOrderByDisplayOrder(hackathonId));
	}

	/**
	 * Validates that adding/updating a criteria with the given weight won't push
	 * the total over 100 for the hackathon. excludeId is the criteria being updated
	 * (null for new).
	 */
	private void validateWeight(UUID hackathonId, int newWeight, UUID excludeId) {
		int existing = criteriaRepository.sumWeightsByHackathonId(hackathonId);
		// If updating, subtract the existing weight of the criteria being replaced
		if (excludeId != null) {
			existing -= criteriaRepository.findById(excludeId).map(VotingCriteria::getWeight).orElse(0);
		}
		if (existing + newWeight > 100) {
			throw new WeightExceedsLimitException(existing, newWeight);
		}
	}

	public static class WeightExceedsLimitException extends RuntimeException {
		public WeightExceedsLimitException(int current, int adding) {
			super("Total weight would exceed 100: current=" + current + ", adding=" + adding);
		}
	}
}
