package wtf.hackhub.presentation.idea;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import wtf.hackhub.application.idea.*;
import wtf.hackhub.domain.Comment;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.domain.IdeaScore;
import wtf.hackhub.infrastructure.config.SecurityConfig;
import wtf.hackhub.infrastructure.security.JwtAuthFilter;
import wtf.hackhub.infrastructure.security.JwtProvider;
import wtf.hackhub.presentation.common.GlobalExceptionHandler;
import wtf.hackhub.support.MockAuthHelper;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(IdeaController.class)
@Import({SecurityConfig.class, JwtAuthFilter.class, GlobalExceptionHandler.class})
@TestPropertySource(properties = {
		"app.jwt.private-key=-----BEGIN PRIVATE KEY-----\\nMIIEvAIBADANBg=====\\n-----END PRIVATE KEY-----",
		"app.jwt.public-key=-----BEGIN PUBLIC KEY-----\\nMIIBIjANBg=====\\n-----END PUBLIC KEY-----",
		"app.cors.allowed-origins=http://localhost:5173", "app.minio.endpoint=http://localhost:9000",
		"app.minio.access-key=test", "app.minio.secret-key=test"})
class IdeaControllerTest {
	@MockBean wtf.hackhub.presentation.websocket.HackathonEventPublisher events;

	@Autowired
	MockMvc mvc;
	@MockBean
	NomineeDirectory nomineeDirectory;
	@MockBean
	NominationApprovalService approvalService;
	@MockBean
	wtf.hackhub.infrastructure.persistence.idea.IdeaRepository ideaRepository;
	@MockBean
	SubmitIdeaUseCase submitIdeaUseCase;
	@MockBean
	GetIdeasUseCase getIdeasUseCase;
	@MockBean
	VoteIdeaUseCase voteIdeaUseCase;
	@MockBean
	CommentUseCase commentUseCase;
	@MockBean
	ScoreIdeaUseCase scoreIdeaUseCase;
	@MockBean
	JwtProvider jwtProvider;

	static final UUID USER_ID = UUID.randomUUID();
	static final UUID HACKATHON_ID = UUID.randomUUID();
	static final UUID IDEA_ID = UUID.randomUUID();

	static Idea idea() {
		return new Idea("My Idea", "Desc", HACKATHON_ID, null, USER_ID, "tech");
	}

	@Test
	void clear_votes_uses_authenticated_user_only() throws Exception {
		mvc.perform(delete("/api/v1/me/votes").param("userId", UUID.randomUUID().toString())
				.with(MockAuthHelper.asParticipant(USER_ID))).andExpect(status().isNoContent());
		verify(voteIdeaUseCase).clearAll(USER_ID);
	}

	@Test
	void anonymous_cannot_clear_votes() throws Exception {
		mvc.perform(delete("/api/v1/me/votes")).andExpect(status().isUnauthorized());
		verifyNoInteractions(voteIdeaUseCase);
	}

	@Test
	void list_ideas_uses_batched_votes_without_per_idea_queries() throws Exception {
		Idea first = idea(), second = idea();
		UUID secondId = UUID.randomUUID();
		org.springframework.test.util.ReflectionTestUtils.setField(first, "id", IDEA_ID);
		org.springframework.test.util.ReflectionTestUtils.setField(second, "id", secondId);
		when(getIdeasUseCase.listByHackathon(any(), any())).thenReturn(new PageImpl<>(List.of(first, second)));
		when(getIdeasUseCase.votedIdeaIds(List.of(IDEA_ID, secondId), USER_ID)).thenReturn(java.util.Set.of(secondId));
		mvc.perform(get("/api/v1/hackathons/" + HACKATHON_ID + "/ideas").with(MockAuthHelper.asParticipant(USER_ID)))
				.andExpect(status().isOk()).andExpect(jsonPath("$.content[0].userHasVoted").value(false))
				.andExpect(jsonPath("$.content[1].userHasVoted").value(true));
		verify(getIdeasUseCase).votedIdeaIds(List.of(IDEA_ID, secondId), USER_ID);
		verify(getIdeasUseCase, never()).hasVoted(any(), any());
	}

	@Test
	void list_ideas_returns_page() throws Exception {
		when(getIdeasUseCase.listByHackathon(any(), any())).thenReturn(new PageImpl<>(List.of(idea())));
		mvc.perform(get("/api/v1/hackathons/" + HACKATHON_ID + "/ideas").with(MockAuthHelper.asParticipant(USER_ID)))
				.andExpect(status().isOk()).andExpect(jsonPath("$.content[0].title").value("My Idea"));
	}

	@Test
	void list_ideas_unauthenticated_returns_401() throws Exception {
		mvc.perform(get("/api/v1/hackathons/" + HACKATHON_ID + "/ideas")).andExpect(status().isUnauthorized());
	}

	@Test
	void get_by_id_found() throws Exception {
		when(ideaRepository.findById(IDEA_ID)).thenReturn(java.util.Optional.of(idea()));
		when(approvalService.canRead(any(), any())).thenReturn(true);
		mvc.perform(get("/api/v1/ideas/" + IDEA_ID).with(MockAuthHelper.asParticipant(USER_ID)))
				.andExpect(status().isOk()).andExpect(jsonPath("$.title").value("My Idea"));
	}

	@Test
	void get_by_id_not_found_returns_404() throws Exception {
		when(ideaRepository.findById(IDEA_ID)).thenReturn(java.util.Optional.empty());
		mvc.perform(get("/api/v1/ideas/" + IDEA_ID).with(MockAuthHelper.asParticipant(USER_ID)))
				.andExpect(status().isNotFound());
	}

	@Test
	void create_idea_valid_returns_201() throws Exception {
		when(submitIdeaUseCase.executeNomination(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(),
				any())).thenReturn(idea());
		mvc.perform(post("/api/v1/hackathons/" + HACKATHON_ID + "/ideas").with(MockAuthHelper.asAdmin(USER_ID))
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"title\":\"My Idea\",\"description\":\"Desc\",\"category\":\"tech\"}"))
				.andExpect(status().isCreated()).andExpect(jsonPath("$.title").value("My Idea"));
	}

	@Test
	void participant_can_submit_nomination_for_approval() throws Exception {
		when(submitIdeaUseCase.executeNomination(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(idea());
		mvc.perform(post("/api/v1/hackathons/" + HACKATHON_ID + "/ideas").with(MockAuthHelper.asParticipant(USER_ID))
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"title\":\"My Idea\",\"description\":\"Desc\",\"category\":\"tech\"}"))
				.andExpect(status().isCreated());
	}

	@Test
	void create_idea_missing_title_returns_400() throws Exception {
		mvc.perform(post("/api/v1/hackathons/" + HACKATHON_ID + "/ideas").with(MockAuthHelper.asAdmin(USER_ID))
				.contentType(MediaType.APPLICATION_JSON).content("{\"description\":\"d\",\"category\":\"tech\"}"))
				.andExpect(status().isBadRequest()).andExpect(jsonPath("$.title").value("Validation Failed"));
	}

	@Test
	void delete_idea_returns_204_for_admin() throws Exception {
		mvc.perform(delete("/api/v1/ideas/" + IDEA_ID).with(MockAuthHelper.asAdmin(USER_ID)))
				.andExpect(status().isNoContent());
		verify(submitIdeaUseCase).delete(IDEA_ID, USER_ID);
	}

	@Test
	void only_admin_can_delete_single_or_batch() throws Exception {
		for (var auth : List.of(MockAuthHelper.asParticipant(USER_ID), MockAuthHelper.asManager(USER_ID))) {
			mvc.perform(delete("/api/v1/ideas/" + IDEA_ID).with(auth)).andExpect(status().isForbidden());
			mvc.perform(post("/api/v1/ideas/batch-delete").with(auth).contentType(MediaType.APPLICATION_JSON)
					.content("{\"ids\":[\"" + IDEA_ID + "\"]}")).andExpect(status().isForbidden());
		}
		verifyNoInteractions(submitIdeaUseCase);
	}

	@Test
	void batch_requires_authentication_and_nonempty_ids() throws Exception {
		mvc.perform(post("/api/v1/ideas/batch-delete").contentType(MediaType.APPLICATION_JSON)
				.content("{\"ids\":[\"" + IDEA_ID + "\"]}")).andExpect(status().isUnauthorized());
		for (String body : List.of("{}", "{\"ids\":[]}", "{\"ids\":[null]}")) {
			mvc.perform(post("/api/v1/ideas/batch-delete").with(MockAuthHelper.asAdmin(USER_ID))
					.contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
		}
		verifyNoInteractions(submitIdeaUseCase);
	}

	@Test
	void admin_can_delete_batch() throws Exception {
		mvc.perform(post("/api/v1/ideas/batch-delete").with(MockAuthHelper.asAdmin(USER_ID))
				.contentType(MediaType.APPLICATION_JSON).content("{\"ids\":[\"" + IDEA_ID + "\"]}"))
				.andExpect(status().isNoContent());
		verify(submitIdeaUseCase).deleteMany(List.of(IDEA_ID), USER_ID);
	}

	@Test
	void vote_returns_toggle_state() throws Exception {
		when(voteIdeaUseCase.execute(IDEA_ID, USER_ID)).thenReturn(new VoteIdeaUseCase.Result(true, 5L));
		mvc.perform(post("/api/v1/ideas/" + IDEA_ID + "/votes").with(MockAuthHelper.asParticipant(USER_ID)))
				.andExpect(status().isOk()).andExpect(jsonPath("$.voted").value(true))
				.andExpect(jsonPath("$.voteCount").value(5));
	}

	@Test
	void vote_unknown_idea_returns_404() throws Exception {
		when(voteIdeaUseCase.execute(any(), any())).thenThrow(new VoteIdeaUseCase.IdeaNotFoundException(IDEA_ID));
		mvc.perform(post("/api/v1/ideas/" + IDEA_ID + "/votes").with(MockAuthHelper.asParticipant(USER_ID)))
				.andExpect(status().isNotFound());
	}

	@Test
	void vote_rule_violation_returns_409_with_detail() throws Exception {
		when(voteIdeaUseCase.execute(any(), any())).thenThrow(new VoteIdeaUseCase.VoteLimitExceededException(4));
		mvc.perform(post("/api/v1/ideas/" + IDEA_ID + "/votes").with(MockAuthHelper.asParticipant(USER_ID)))
				.andExpect(status().isConflict()).andExpect(jsonPath("$.title").value("Voting Rule Conflict"))
				.andExpect(jsonPath("$.detail").value("Each participant can cast at most 4 votes per award category."));
	}

	@Test
	void list_comments_returns_array() throws Exception {
		when(commentUseCase.listForIdea(IDEA_ID)).thenReturn(List.of(new Comment(IDEA_ID, USER_ID, "nice!")));
		mvc.perform(get("/api/v1/ideas/" + IDEA_ID + "/comments").with(MockAuthHelper.asParticipant(USER_ID)))
				.andExpect(status().isOk()).andExpect(jsonPath("$[0].content").value("nice!"));
	}

	@Test
	void add_comment_returns_201() throws Exception {
		when(commentUseCase.add(any(), any(), any())).thenReturn(new Comment(IDEA_ID, USER_ID, "great"));
		mvc.perform(post("/api/v1/ideas/" + IDEA_ID + "/comments").with(MockAuthHelper.asParticipant(USER_ID))
				.contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"great\"}"))
				.andExpect(status().isCreated()).andExpect(jsonPath("$.content").value("great"));
	}

	@Test
	void add_comment_missing_content_returns_400() throws Exception {
		mvc.perform(post("/api/v1/ideas/" + IDEA_ID + "/comments").with(MockAuthHelper.asParticipant(USER_ID))
				.contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"\"}"))
				.andExpect(status().isBadRequest());
	}

	// ── score ─────────────────────────────────────────────────────────────────

	@Test
	void score_idea_returns_200() throws Exception {
		UUID criteriaId = UUID.randomUUID();
		IdeaScore score = new IdeaScore(IDEA_ID, USER_ID, criteriaId, 8);
		when(scoreIdeaUseCase.execute(any(), any(), any(), anyInt())).thenReturn(score);

		mvc.perform(post("/api/v1/ideas/" + IDEA_ID + "/scores").with(MockAuthHelper.asParticipant(USER_ID))
				.contentType(MediaType.APPLICATION_JSON).content("{\"criteriaId\":\"" + criteriaId + "\",\"score\":8}"))
				.andExpect(status().isOk()).andExpect(jsonPath("$.score").value(8));
	}

	@Test
	void score_unknown_criteria_returns_400() throws Exception {
		UUID criteriaId = UUID.randomUUID();
		when(scoreIdeaUseCase.execute(any(), any(), any(), anyInt()))
				.thenThrow(new ScoreIdeaUseCase.CriteriaNotFoundException(criteriaId));

		mvc.perform(post("/api/v1/ideas/" + IDEA_ID + "/scores").with(MockAuthHelper.asParticipant(USER_ID))
				.contentType(MediaType.APPLICATION_JSON).content("{\"criteriaId\":\"" + criteriaId + "\",\"score\":8}"))
				.andExpect(status().isBadRequest());
	}

	@Test
	void score_criteria_mismatch_returns_400() throws Exception {
		UUID criteriaId = UUID.randomUUID();
		when(scoreIdeaUseCase.execute(any(), any(), any(), anyInt()))
				.thenThrow(new ScoreIdeaUseCase.CriteriaMismatchException(criteriaId, HACKATHON_ID));

		mvc.perform(post("/api/v1/ideas/" + IDEA_ID + "/scores").with(MockAuthHelper.asParticipant(USER_ID))
				.contentType(MediaType.APPLICATION_JSON).content("{\"criteriaId\":\"" + criteriaId + "\",\"score\":8}"))
				.andExpect(status().isBadRequest());
	}

	@Test
	void score_invalid_score_value_returns_400() throws Exception {
		UUID criteriaId = UUID.randomUUID();
		when(scoreIdeaUseCase.execute(any(), any(), any(), anyInt()))
				.thenThrow(new wtf.hackhub.domain.IdeaScore.InvalidScoreException(150));

		mvc.perform(post("/api/v1/ideas/" + IDEA_ID + "/scores").with(MockAuthHelper.asParticipant(USER_ID))
				.contentType(MediaType.APPLICATION_JSON)
				.content("{\"criteriaId\":\"" + criteriaId + "\",\"score\":150}")).andExpect(status().isBadRequest());
	}
}
