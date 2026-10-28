package wtf.hackhub.infrastructure.security;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.domain.TeamMember;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;
import wtf.hackhub.infrastructure.persistence.team.TeamMemberRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class StorageSecurityServiceTest {
	@Mock
	TeamMemberRepository members;
	@Mock
	HackathonSecurityService hackathons;
	@Mock
	IdeaRepository ideas;
	@InjectMocks
	StorageSecurityService security;
	final UUID user = UUID.randomUUID(), other = UUID.randomUUID(), campaign = UUID.randomUUID();
	final Authentication auth = new UsernamePasswordAuthenticationToken(user, null,
			List.of(new SimpleGrantedAuthority("ROLE_MANAGER")));

	@Test
	void nominations_upload_is_scoped_to_caller_and_accessible_campaign() {
		when(hackathons.canView(campaign, auth)).thenReturn(true);
		assertThatCode(
				() -> security.requireAccess("project-attachments", "nominations/" + campaign + "/" + user, true, auth))
				.doesNotThrowAnyException();
		assertThatThrownBy(() -> security.requireAccess("project-attachments", "nominations/" + campaign + "/" + other,
				true, auth)).isInstanceOf(AccessDeniedException.class);
		verifyNoInteractions(ideas);
	}

	@Test
	void foreign_campaign_upload_is_rejected() {
		assertThatThrownBy(
				() -> security.requireAccess("project-attachments", "nominations/" + campaign + "/" + user, true, auth))
				.isInstanceOf(AccessDeniedException.class);
	}

	@Test
	void participant_can_upload_own_nomination_materials() {
		Authentication participant = new UsernamePasswordAuthenticationToken(user, null,
				List.of(new SimpleGrantedAuthority("ROLE_PARTICIPANT")));
		when(hackathons.canView(campaign, participant)).thenReturn(true);
		assertThatCode(() -> security.requireAccess("project-attachments", "nominations/" + campaign + "/" + user,
				true, participant)).doesNotThrowAnyException();
		verifyNoInteractions(ideas);
	}

	@Test
	void published_nomination_is_readable_but_unpublished_files_are_private() {
		String key = "nominations/" + campaign + "/" + other + "/photo.png";
		when(hackathons.canView(campaign, auth)).thenReturn(true);
		Idea idea = new Idea("Nominee", "Details", campaign, null, other, "award");
		when(ideas.findByAttachmentKey(key)).thenReturn(List.of(idea));
		assertThatThrownBy(() -> security.requireAccess("project-attachments", key, false, auth))
				.isInstanceOf(AccessDeniedException.class);
		idea.update("Nominee", "Details", "award", List.of(), Idea.Status.SUBMITTED, null, null, null);
		assertThatCode(() -> security.requireAccess("project-attachments", key, false, auth))
				.doesNotThrowAnyException();
	}

	@Test
	void attaching_someone_elses_key_does_not_grant_access() {
		String key = "nominations/" + campaign + "/" + other + "/photo.png";
		when(hackathons.canView(campaign, auth)).thenReturn(true);
		Idea forged = new Idea("Nominee", "Details", campaign, null, user, "award");
		forged.update("Nominee", "Details", "award", List.of(), Idea.Status.SUBMITTED, null, null, null);
		when(ideas.findByAttachmentKey(key)).thenReturn(List.of(forged));
		assertThatThrownBy(() -> security.requireAccess("project-attachments", key, false, auth))
				.isInstanceOf(AccessDeniedException.class);
	}

	@Test
	void team_avatar_requires_leadership_for_upload() {
		when(members.findByTeamIdAndUserId(other, user))
				.thenReturn(Optional.of(new TeamMember(other, user, TeamMember.Role.MEMBER)));
		assertThatThrownBy(() -> security.requireAccess("team-avatars", "teams/" + other, true, auth))
				.isInstanceOf(AccessDeniedException.class);
		when(members.findByTeamIdAndUserId(other, user))
				.thenReturn(Optional.of(new TeamMember(other, user, TeamMember.Role.LEADER)));
		assertThatCode(() -> security.requireAccess("team-avatars", "teams/" + other, true, auth))
				.doesNotThrowAnyException();
	}

	@Test
	void banner_requires_campaign_management_permission() {
		assertThatThrownBy(() -> security.requireAccess("hackathon-assets", "banners/" + campaign, true, auth))
				.isInstanceOf(AccessDeniedException.class);
		when(hackathons.canManage(campaign, auth)).thenReturn(true);
		assertThatCode(() -> security.requireAccess("hackathon-assets", "banners/" + campaign, true, auth))
				.doesNotThrowAnyException();
	}

	@Test
	void malformed_and_unscoped_paths_fail_closed() {
		for (String path : List.of("uploads", "avatars/" + user + "/../other", "avatars//" + user,
				"avatars/" + user + "%2Fother", "/avatars/" + user, "avatars/not-a-uuid", "avatars/" + user + "/")) {
			assertThatThrownBy(() -> security.requireAccess("avatars", path, true, auth))
					.isInstanceOf(AccessDeniedException.class);
		}
		verifyNoInteractions(members, hackathons, ideas);
	}
}
