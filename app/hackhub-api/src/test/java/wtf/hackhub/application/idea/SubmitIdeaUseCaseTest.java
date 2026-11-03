package wtf.hackhub.application.idea;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.domain.Hackathon;
import wtf.hackhub.infrastructure.persistence.hackathon.HackathonRepository;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;
import wtf.hackhub.infrastructure.persistence.organization.OrganizationMemberRepository;
import wtf.hackhub.infrastructure.persistence.team.TeamMemberRepository;
import wtf.hackhub.infrastructure.persistence.team.TeamRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SubmitIdeaUseCaseTest {

	@Mock
	wtf.hackhub.infrastructure.persistence.IdeaMutationLock mutationLock;

	@Mock
	wtf.hackhub.infrastructure.storage.NominationPdfValidator pdfValidator;
	@Mock
	wtf.hackhub.application.team.CreateTeamUseCase createTeam;
	@Mock
	IdeaRepository ideaRepository;
	@Mock
	HackathonRepository hackathonRepository;
	@Mock
	TeamRepository teamRepository;
	@Mock
	TeamMemberRepository teamMemberRepository;
	@Mock
	OrganizationMemberRepository orgMemberRepository;
	@Mock
	wtf.hackhub.infrastructure.persistence.auth.ProfileRepository profileRepository;
	@Mock
	wtf.hackhub.infrastructure.persistence.judging.JudgeScoreRepository judgeScoreRepository;
	@Mock
	NomineeDirectory nomineeDirectory;
	@Mock
	NominationApprovalDirectory approvalDirectory;
	@Mock
	NominationApprovalService approvalService;
	@org.junit.jupiter.api.BeforeEach
	void metadata() {
		var manager = new wtf.hackhub.domain.Profile("manager@example.test", "Manager", "hash");
		manager.changeRole(wtf.hackhub.domain.Profile.Role.MANAGER);
		org.mockito.Mockito.lenient().when(profileRepository.findById(USER_ID)).thenReturn(Optional.of(manager));
		org.mockito.Mockito.lenient().when(nomineeDirectory.enrich(org.mockito.ArgumentMatchers.nullable(String.class),
				org.mockito.ArgumentMatchers.anyBoolean())).thenAnswer(call -> call.getArgument(0));
	}
	@InjectMocks
	SubmitIdeaUseCase useCase;

	static final UUID USER_ID = UUID.randomUUID();
	static final UUID HACKATHON_ID = UUID.randomUUID();

	static Idea idea(UUID creator) {
		return new Idea("title", "desc", HACKATHON_ID, null, creator, "AI");
	}

	private void stubValidSubmit() {
		Hackathon hackathon = new Hackathon("H", "D", Instant.now(), Instant.now().plusSeconds(100), null, 4, 100,
				UUID.randomUUID(), null);
		when(hackathonRepository.findById(HACKATHON_ID)).thenReturn(Optional.of(hackathon));
	}

	@Test
	void submits_new_idea() {
		stubValidSubmit();
		Idea saved = idea(USER_ID);
		when(ideaRepository.save(any())).thenReturn(saved);

		Idea result = useCase.execute("title", "desc", HACKATHON_ID, null, USER_ID, "AI", List.of("ml"));
		assertThat(result.getTitle()).isEqualTo("title");
	}

	@Test
	void normalizes_mixed_tag_separators_before_saving() {
		stubValidSubmit();
		when(ideaRepository.save(any())).thenAnswer(call -> call.getArgument(0));
		Idea result = useCase.execute("title", "desc", HACKATHON_ID, null, USER_ID, "AI",
				List.of(" IoT、Digital Twin，AI,Impact、IoT、 ", "Cloud"));
		assertThat(result.getTags()).containsExactly("IoT", "Digital Twin", "AI", "Impact", "Cloud");
	}

	@Test
	void rejects_more_than_five_tags_on_create_and_update() {
		stubValidSubmit();
		List<String> tags = List.of("one、two，three,four、five、six");
		assertThatThrownBy(() -> useCase.execute("title", "desc", HACKATHON_ID, null, USER_ID, "AI", tags))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("5 tags");
		Idea existing = idea(USER_ID);
		when(ideaRepository.findById(any())).thenReturn(Optional.of(existing));
		assertThatThrownBy(() -> useCase.update(UUID.randomUUID(), USER_ID, "title", "desc", "AI", tags,
				Idea.Status.SUBMITTED, null, null, null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("5 tags");
		verify(ideaRepository, org.mockito.Mockito.never()).save(any());
	}

	@Test
	void update_changes_fields() {
		Idea existing = idea(USER_ID);
		when(ideaRepository.findById(any())).thenReturn(Optional.of(existing));
		when(ideaRepository.save(any())).thenReturn(existing);

		UUID id = UUID.randomUUID();
		useCase.update(id, USER_ID, "new title", "d", "AI", List.of(), Idea.Status.SUBMITTED, null, null, null);
		verify(ideaRepository).save(existing);
	}

	@Test
	void update_by_non_owner_throws() {
		Idea existing = idea(UUID.randomUUID()); // owned by different user
		when(ideaRepository.findById(any())).thenReturn(Optional.of(existing));

		assertThatThrownBy(() -> useCase.update(UUID.randomUUID(), USER_ID, "t", "d", "AI", List.of(),
				Idea.Status.DRAFT, null, null, null)).isInstanceOf(SubmitIdeaUseCase.IdeaAccessDeniedException.class);
	}

	@org.junit.jupiter.params.ParameterizedTest
	@org.junit.jupiter.params.provider.EnumSource(value = wtf.hackhub.domain.Profile.Role.class, names = {"PARTICIPANT", "MANAGER"})
	void delete_rejects_non_admin_even_if_owner(wtf.hackhub.domain.Profile.Role role) {
		var requester = new wtf.hackhub.domain.Profile("user@test.com", "User", "hash");
		requester.changeRole(role);
		when(profileRepository.findById(USER_ID)).thenReturn(Optional.of(requester));
		assertThatThrownBy(() -> useCase.delete(UUID.randomUUID(), USER_ID))
				.isInstanceOf(SubmitIdeaUseCase.IdeaAccessDeniedException.class);
		org.mockito.Mockito.verifyNoInteractions(ideaRepository, mutationLock);
	}

	@Test
	void admin_deletes_another_owners_voted_nomination() {
		stubAdmin();
		Idea existing = idea(UUID.randomUUID());
		org.springframework.test.util.ReflectionTestUtils.setField(existing, "id", UUID.randomUUID());
		org.springframework.test.util.ReflectionTestUtils.setField(existing, "votes", 2);
		when(ideaRepository.findById(existing.getId())).thenReturn(Optional.of(existing));
		useCase.delete(existing.getId(), USER_ID);
		verify(ideaRepository).deleteAll(List.of(existing));
		verify(ideaRepository).flush();
	}

	@Test
	void batch_validates_all_ids_before_deleting() {
		stubAdmin();
		UUID missing = UUID.randomUUID();
		when(ideaRepository.findById(missing)).thenReturn(Optional.empty());
		assertThatThrownBy(() -> useCase.deleteMany(List.of(missing), USER_ID))
				.isInstanceOf(VoteIdeaUseCase.IdeaNotFoundException.class);
		verify(ideaRepository, org.mockito.Mockito.never()).deleteAll(org.mockito.ArgumentMatchers.anyIterable());
	}

	@Test
	void batch_deduplicates_and_locks_in_stable_order() {
		stubAdmin();
		Idea first = idea(USER_ID), second = idea(UUID.randomUUID());
		org.springframework.test.util.ReflectionTestUtils.setField(first, "id", UUID.randomUUID());
		org.springframework.test.util.ReflectionTestUtils.setField(second, "id", UUID.randomUUID());
		when(ideaRepository.findById(first.getId())).thenReturn(Optional.of(first));
		when(ideaRepository.findById(second.getId())).thenReturn(Optional.of(second));
		useCase.deleteMany(List.of(second.getId(), first.getId(), second.getId()), USER_ID);
		var ids = List.of(first.getId(), second.getId()).stream().sorted().toList();
		var ordered = org.mockito.Mockito.inOrder(mutationLock, ideaRepository);
		for (UUID id : ids) ordered.verify(mutationLock).acquire(id);
		for (UUID id : ids) ordered.verify(ideaRepository).findById(id);
		verify(ideaRepository).deleteAll(org.mockito.ArgumentMatchers.argThat(items -> java.util.stream.StreamSupport.stream(items.spliterator(), false).count() == 2));
	}

	private void stubAdmin() {
		var requester = new wtf.hackhub.domain.Profile("admin@test.com", "Admin", "hash");
		requester.changeRole(wtf.hackhub.domain.Profile.Role.ADMIN);
		when(profileRepository.findById(USER_ID)).thenReturn(Optional.of(requester));
	}

	@Test
	void execute_with_null_tags_skips_update_call() {
		stubValidSubmit();
		Idea saved = idea(USER_ID);
		when(ideaRepository.save(any())).thenReturn(saved);

		Idea result = useCase.execute("title", "desc", HACKATHON_ID, null, USER_ID, "AI", null);
		assertThat(result.getTitle()).isEqualTo("title");
	}

	@Test
	void execute_with_org_rejects_non_org_member() {
		UUID orgId = UUID.randomUUID();
		Hackathon hackathon = new Hackathon("H", "D", Instant.now(), Instant.now().plusSeconds(100), null, 4, 100,
				UUID.randomUUID(), orgId);
		when(hackathonRepository.findById(HACKATHON_ID)).thenReturn(Optional.of(hackathon));
		when(orgMemberRepository.existsByOrganizationIdAndUserId(orgId, USER_ID)).thenReturn(false);

		assertThatThrownBy(() -> useCase.execute("t", "d", HACKATHON_ID, null, USER_ID, "AI", List.of()))
				.isInstanceOf(SubmitIdeaUseCase.IdeaAccessDeniedException.class);
	}

	@Test
	void update_null_status_preserves_existing_status() {
		Idea existing = idea(USER_ID);
		when(ideaRepository.findById(any())).thenReturn(Optional.of(existing));
		when(ideaRepository.save(any())).thenReturn(existing);

		useCase.update(UUID.randomUUID(), USER_ID, "t", "d", "AI", List.of(), null, null, null, null);
		// existing status is DRAFT — null passed in, should remain DRAFT
		verify(ideaRepository).save(existing);
	}
	@Test
	void participant_cannot_change_nominee_to_another_profile() {
		UUID ideaId = UUID.randomUUID(), nomineeId = UUID.randomUUID();
		when(ideaRepository.findById(ideaId)).thenReturn(Optional.of(idea(USER_ID)));
		when(profileRepository.existsById(nomineeId)).thenReturn(true);
		when(profileRepository.findById(USER_ID))
				.thenReturn(Optional.of(new wtf.hackhub.domain.Profile("p@bosch.com", "Participant", "hash")));
		String metadata = "[{\"type\":\"nomination\",\"nomineeUserId\":\"" + nomineeId + "\"}]";
		assertThatThrownBy(() -> useCase.update(ideaId, USER_ID, "Title", "Desc", idea(USER_ID).getCategory(), List.of(), null,
				null, null, metadata)).isInstanceOf(SubmitIdeaUseCase.IdeaAccessDeniedException.class);
		org.mockito.Mockito.verify(ideaRepository, org.mockito.Mockito.never()).save(any());
	}

	@Test
	void creates_nomination_with_metadata_and_submitted_status_in_one_save() {
		stubValidSubmit();
		when(profileRepository.existsById(USER_ID)).thenReturn(true);
		when(ideaRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
		String metadata = "[{\"type\":\"nomination\",\"nomineeUserId\":\"" + USER_ID + "\"}]";
		Idea saved = useCase.executeNomination("Nomination", "Evidence", HACKATHON_ID, null, USER_ID,
				"Customer Values", List.of(), Idea.Status.SUBMITTED, "https://example.com/evidence", null, metadata);
		assertThat(saved.getStatus()).isEqualTo(Idea.Status.SUBMITTED);
		assertThat(saved.getProjectAttachments()).isEqualTo(metadata);
		assertThat(saved.getRepositoryUrl()).isEqualTo("https://example.com/evidence");
		verify(ideaRepository).save(saved);
	}

	@Test
	void invalid_nominee_does_not_leave_a_partially_created_case() {
		stubValidSubmit();
		String metadata = "[{\"type\":\"nomination\",\"nomineeUserId\":\"" + UUID.randomUUID() + "\"}]";
		assertThatThrownBy(() -> useCase.executeNomination("Nomination", "Evidence", HACKATHON_ID, null, USER_ID,
				"Customer Values", List.of(), Idea.Status.SUBMITTED, null, null, metadata))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("Nominee profile not found");
		org.mockito.Mockito.verify(ideaRepository, org.mockito.Mockito.never()).save(any());
	}

	@Test
	void rejects_moving_a_voted_case_to_another_track() {
		UUID ideaId = UUID.randomUUID();
		Idea existing = idea(USER_ID);
		org.springframework.test.util.ReflectionTestUtils.setField(existing, "votes", 1);
		when(ideaRepository.findById(ideaId)).thenReturn(Optional.of(existing));
		assertThatThrownBy(() -> useCase.update(ideaId, USER_ID, "Title", "Desc", "Customer Values", List.of(), null,
				null, null, null)).isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
				.hasMessageContaining("award category cannot change");
		org.mockito.Mockito.verify(ideaRepository, org.mockito.Mockito.never()).save(any());
		var ordered = org.mockito.Mockito.inOrder(mutationLock, ideaRepository);
		ordered.verify(mutationLock).acquire(ideaId);
		ordered.verify(ideaRepository).findById(ideaId);
	}

	@Test
	void rejects_removing_manager_nominee_metadata_after_committee_scoring() {
		UUID ideaId = UUID.randomUUID(), nominee = UUID.randomUUID();
		Idea existing = idea(USER_ID);
		existing.update("Title", "Desc", "AI", List.of(), Idea.Status.SUBMITTED, null, null,
				"[{\"type\":\"nomination\",\"nomineeUserId\":\"" + nominee + "\"}]");
		when(ideaRepository.findById(ideaId)).thenReturn(Optional.of(existing));
		when(judgeScoreRepository.findAllByIdeaId(ideaId)).thenReturn(List
				.of(new wtf.hackhub.domain.JudgeScore(HACKATHON_ID, ideaId, UUID.randomUUID(), null, 8, "Evidence")));
		assertThatThrownBy(
				() -> useCase.update(ideaId, USER_ID, "Title", "Desc", "AI", List.of(), null, null, null, null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("Track and nominee cannot change");
	}

	@Test
	void individual_document_requires_owned_pdf_and_checks_stored_object() {
		stubValidSubmit();
		when(ideaRepository.save(any())).thenAnswer(call -> call.getArgument(0));
		String key = "nominations/" + HACKATHON_ID + "/" + USER_ID + "/evidence.pdf";
		String attachment = "[{\"type\":\"document\",\"storageKey\":\"" + key + "\",\"size\":1,\"mimeType\":\"application/pdf\"}]";
		useCase.executeNomination("Nomination", "Evidence", HACKATHON_ID, null, USER_ID,
				"Customer Values", List.of(), Idea.Status.SUBMITTED, null, null, attachment);
		verify(pdfValidator).validate(key);
		for (String invalid : List.of(attachment.replace(USER_ID.toString(), UUID.randomUUID().toString()),
				attachment.replace("evidence.pdf", "evidence.zip"), "[{\"type\":\"document\",\"url\":\"https://example.invalid/file.pdf\"}]"))
			assertThatThrownBy(() -> useCase.executeNomination("Nomination", "Evidence", HACKATHON_ID, null, USER_ID,
					"Customer Values", List.of(), Idea.Status.SUBMITTED, null, null, invalid))
					.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("own PDF");
	}

	@Test
	void existing_individual_nomination_blocks_another_track_before_saving() {
		stubValidSubmit();
		when(ideaRepository.findByCreatedByOrderByCreatedAtDesc(USER_ID)).thenReturn(List.of(idea(USER_ID)));
		assertThatThrownBy(() -> useCase.executeNomination("Second", "Evidence", HACKATHON_ID, null, USER_ID,
				"Innovation Breakthrough", List.of(), Idea.Status.SUBMITTED, null, null, null))
				.isInstanceOf(org.springframework.web.server.ResponseStatusException.class).hasMessageContaining("only one individual");
		org.mockito.Mockito.verify(ideaRepository, org.mockito.Mockito.never()).save(any());
	}

	private void stubIndividualRequester(wtf.hackhub.domain.Profile.Role role, UUID orgId) {
		Hackathon hackathon = new Hackathon("Award", "Digital Pioneer", Instant.now(),
				Instant.now().plusSeconds(100), null, 4, 100, USER_ID, orgId);
		assertThat(hackathon.getStatus()).isEqualTo(Hackathon.Status.DRAFT);
		when(hackathonRepository.findById(HACKATHON_ID)).thenReturn(Optional.of(hackathon));
		var requester = new wtf.hackhub.domain.Profile("manager@example.test", "Manager", "hash");
		requester.changeRole(role);
		when(profileRepository.findById(USER_ID)).thenReturn(Optional.of(requester));
	}

	@org.junit.jupiter.params.ParameterizedTest
	@org.junit.jupiter.params.provider.EnumSource(value = wtf.hackhub.domain.Profile.Role.class, names = {"ADMIN", "MANAGER"})
	void submits_individual_nomination_in_draft_award_without_a_team(wtf.hackhub.domain.Profile.Role role) {
		stubIndividualRequester(role, null);
		when(profileRepository.existsById(USER_ID)).thenReturn(true);
		when(ideaRepository.save(any())).thenAnswer(call -> call.getArgument(0));
		String metadata = "[{\"type\":\"nomination\",\"nomineeUserId\":\"" + USER_ID + "\"}]";
		Idea result = useCase.executeNomination("Nominee", "Impact", HACKATHON_ID, null, USER_ID,
				"Customer Values", List.of("Digital"), Idea.Status.SUBMITTED, null, null, metadata);
		assertThat(result.getTeamId()).isNull();
		assertThat(result.getStatus()).isEqualTo(Idea.Status.SUBMITTED);
		assertThat(result.getProjectAttachments()).isEqualTo(metadata);
		org.mockito.Mockito.verifyNoInteractions(teamRepository, teamMemberRepository);
	}

	@Test
	void employee_nomination_requires_verified_roster_identity() {
		stubIndividualRequester(wtf.hackhub.domain.Profile.Role.PARTICIPANT, null);
		when(approvalDirectory.requireEmployee(USER_ID)).thenThrow(new IllegalArgumentException("SSO roster required"));
		assertThatThrownBy(() -> useCase.executeNomination("Nominee", "Impact", HACKATHON_ID, null, USER_ID,
				"Customer Values", List.of(), Idea.Status.SUBMITTED, null, null, null))
				.isInstanceOf(IllegalArgumentException.class);
		org.mockito.Mockito.verifyNoInteractions(teamRepository, teamMemberRepository);
		org.mockito.Mockito.verify(ideaRepository, org.mockito.Mockito.never()).save(any());
	}

	@Test
	void individual_nomination_preserves_organization_membership_check() {
		stubIndividualRequester(wtf.hackhub.domain.Profile.Role.MANAGER, UUID.randomUUID());
		assertThatThrownBy(() -> useCase.executeNomination("Nominee", "Impact", HACKATHON_ID, null, USER_ID,
				"Customer Values", List.of(), Idea.Status.SUBMITTED, null, null, null))
				.isInstanceOf(SubmitIdeaUseCase.IdeaAccessDeniedException.class);
		org.mockito.Mockito.verifyNoInteractions(teamRepository, teamMemberRepository);
		org.mockito.Mockito.verify(ideaRepository, org.mockito.Mockito.never()).save(any());
	}

}
