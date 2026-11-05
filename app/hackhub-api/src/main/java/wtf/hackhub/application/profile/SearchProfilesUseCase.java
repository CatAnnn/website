package wtf.hackhub.application.profile;

import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import wtf.hackhub.infrastructure.persistence.auth.ProfileRepository;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class SearchProfilesUseCase {

	private final ProfileRepository profiles;

	public SearchProfilesUseCase(ProfileRepository profiles) {
		this.profiles = profiles;
	}

	@Transactional(readOnly = true)
	public List<Match> execute(String query) {
		String normalized = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
		if (normalized.length() < 2) {
			return List.of();
		}
		if (normalized.length() > 200) {
			throw new IllegalArgumentException("Search query must not exceed 200 characters.");
		}
		// 在数据库端限制数量，仅向提名表单返回识别成员所需字段。
		return profiles.searchByNameOrEmail(normalized, PageRequest.of(0, 20)).stream()
				.map(profile -> new Match(profile.getId(), profile.getName(), profile.getEmail())).toList();
	}

	public record Match(UUID id, String name, String email) {
	}
}
