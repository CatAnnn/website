package wtf.hackhub.application.hackathon;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import wtf.hackhub.domain.Hackathon;
import wtf.hackhub.infrastructure.persistence.hackathon.HackathonRepository;
import wtf.hackhub.infrastructure.persistence.idea.VotingCriteriaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class CreateHackathonUseCase {

	private final HackathonRepository hackathonRepository;
	private final VotingCriteriaRepository criteriaRepository;

	public CreateHackathonUseCase(HackathonRepository hackathonRepository,
			VotingCriteriaRepository criteriaRepository) {
		this.hackathonRepository = hackathonRepository;
		this.criteriaRepository = criteriaRepository;
	}

	@Transactional
	@PreAuthorize("hasRole('ADMIN') or hasRole('MANAGER')")
	public Hackathon execute(Command cmd) {
		String regKey = generateRegistrationKey();
		// Ensure uniqueness (collision extremely unlikely with UUID-based key)
		while (hackathonRepository.existsByRegistrationKey(regKey)) {
			regKey = generateRegistrationKey();
		}
		Hackathon hackathon = new Hackathon(cmd.title(), cmd.description(), cmd.startDate(), cmd.endDate(), regKey,
				cmd.maxTeamSize(), cmd.allowedParticipants(), cmd.createdBy(), cmd.organizationId());
		boolean pioneer = cmd.title().toLowerCase(Locale.ROOT).contains("digital pioneer") || cmd.title().contains("数字先锋");
		if (pioneer) hackathon.updateJudgingConfig(hackathon.getVisibility(), hackathon.getJoinPolicy(), Hackathon.JudgingMode.PANEL, 100);
		Hackathon saved = hackathonRepository.save(hackathon);
		if (pioneer) criteriaRepository.saveAll(wtf.hackhub.application.judging.DigitalPioneerCriteria.template(saved.getId()));
		return saved;
	}

	private String generateRegistrationKey() {
		return UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase();
	}

	public record Command(String title, String description, Instant startDate, Instant endDate, int maxTeamSize,
			int allowedParticipants, UUID createdBy, UUID organizationId, List<String> tags, List<String> prizes) {
	}
}
