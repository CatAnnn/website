package wtf.hackhub.application.idea;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;
import wtf.hackhub.infrastructure.persistence.idea.IdeaVoteRepository;

import java.util.UUID;
import java.util.List;
import java.util.Set;

@Service
public class GetIdeasUseCase {

	private final IdeaRepository ideaRepository;
	private final IdeaVoteRepository voteRepository;

	public GetIdeasUseCase(IdeaRepository ideaRepository, IdeaVoteRepository voteRepository) {
		this.ideaRepository = ideaRepository;
		this.voteRepository = voteRepository;
	}

	@Transactional(readOnly = true)
	public Page<Idea> listByHackathon(UUID hackathonId, Pageable pageable) {
		return ideaRepository.findByHackathonIdOrderByCreatedAtDesc(hackathonId, pageable);
	}

	@Transactional(readOnly = true)
	public Idea getById(UUID id) {
		var idea = ideaRepository.findById(id).orElseThrow(() -> new VoteIdeaUseCase.IdeaNotFoundException(id));
		idea.requireApprovalPublished();
		return idea;
	}

	@Transactional(readOnly = true)
	public Set<UUID> votedIdeaIds(List<UUID> ideaIds, UUID userId) {
		if (userId == null || ideaIds.isEmpty()) return Set.of();
		return Set.copyOf(voteRepository.findVotedIdeaIds(userId, ideaIds));
	}

	@Transactional(readOnly = true)
	public boolean hasVoted(UUID ideaId, UUID userId) {
		return userId != null && voteRepository.existsByIdeaIdAndUserId(ideaId, userId);
	}
}
