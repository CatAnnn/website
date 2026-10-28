package wtf.hackhub.application.idea;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import wtf.hackhub.domain.Comment;
import wtf.hackhub.domain.Profile;
import wtf.hackhub.infrastructure.persistence.idea.CommentRepository;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;
import wtf.hackhub.infrastructure.persistence.auth.ProfileRepository;
import java.util.List;
import java.util.UUID;

@Service
public class CommentUseCase {
	private final CommentRepository commentRepository;
	private final IdeaRepository ideaRepository;
	private final ProfileRepository profileRepository;
	public CommentUseCase(CommentRepository comments, IdeaRepository ideas, ProfileRepository profiles) {
		commentRepository = comments;
		ideaRepository = ideas;
		profileRepository = profiles;
	}
	private void requireIdea(UUID id) {
		ideaRepository.findById(id).orElseThrow(() -> new VoteIdeaUseCase.IdeaNotFoundException(id))
				.requireApprovalPublished();
	}
	private String validated(String content) {
		if (content == null || content.isBlank() || content.trim().length() > 5000)
			throw new IllegalArgumentException("Comment must contain 1 to 5000 characters.");
		return content.trim();
	}
	private Comment find(UUID ideaId, UUID commentId) {
		return commentRepository.findById(commentId).filter(c -> c.getIdeaId().equals(ideaId))
				.orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
	}
	@Transactional
	public Comment add(UUID ideaId, UUID userId, String content) {
		requireIdea(ideaId);
		return commentRepository.save(new Comment(ideaId, userId, validated(content)));
	}
	@Transactional(readOnly = true)
	public List<Comment> listForIdea(UUID ideaId) {
		requireIdea(ideaId);
		return commentRepository.findByIdeaIdOrderByCreatedAtAsc(ideaId);
	}
	@Transactional
	public Comment update(UUID ideaId, UUID commentId, UUID userId, String content) {
		requireIdea(ideaId);
		Comment comment = find(ideaId, commentId);
		if (!comment.getUserId().equals(userId))
			throw new ResponseStatusException(HttpStatus.FORBIDDEN);
		comment.updateContent(validated(content));
		return commentRepository.save(comment);
	}
	@Transactional
	public void delete(UUID ideaId, UUID commentId, UUID userId) {
		requireIdea(ideaId);
		Comment comment = find(ideaId, commentId);
		boolean admin = profileRepository.findById(userId).map(p -> p.getRole() == Profile.Role.ADMIN).orElse(false);
		if (!comment.getUserId().equals(userId) && !admin)
			throw new ResponseStatusException(HttpStatus.FORBIDDEN);
		commentRepository.delete(comment);
	}
}
