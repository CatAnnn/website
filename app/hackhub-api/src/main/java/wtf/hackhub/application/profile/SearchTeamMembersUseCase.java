package wtf.hackhub.application.profile;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class SearchTeamMembersUseCase {

	private final List<IndexedMember> members;

	public SearchTeamMembersUseCase(ObjectMapper mapper) throws IOException {
		try (var input = new ClassPathResource("team-member-directory.json").getInputStream()) {
			List<Member> source = mapper.readValue(input, new TypeReference<List<Member>>() { });
			members = source.stream().map(member -> new IndexedMember(member,
					normalize(member.name()), normalize(member.fullName()))).toList();
		}
	}

	public List<Match> execute(String query) {
		String raw = query == null ? "" : query.strip();
		if (raw.length() > 200) throw new IllegalArgumentException("Search query must not exceed 200 characters.");
		String normalized = normalize(raw.replaceFirst("^@", ""));
		// 中文姓氏可用单字查询；英文仍至少两字符，避免空输入或标点枚举名册。
		if (normalized.replace(" ", "").length() < 2
				&& normalized.codePoints().noneMatch(codePoint -> Character.UnicodeScript.of(codePoint) == Character.UnicodeScript.HAN)) {
			return List.of();
		}
		var tokens = normalized.split(" ");
		// 按词匹配中英文姓名，允许姓与名调换顺序；目录独立于登录账户和审批名册。
		return members.stream().filter(member -> Arrays.stream(tokens).allMatch(token ->
				member.fullName().contains(token) || member.name().replace(" ", "").contains(token)))
				.sorted(Comparator.comparingInt((IndexedMember member) -> member.name().equals(normalized) ? 0 : 1)
						.thenComparing(IndexedMember::name).thenComparing(member -> member.source().id()))
				.limit(20).map(member -> new Match(member.source().id(), member.source().name(), member.source().orgUnit()))
				.toList();
	}

	private static String normalize(String value) {
		return Normalizer.normalize(value, Normalizer.Form.NFKD).replaceAll("\\p{M}+", "")
				.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").strip();
	}

	public record Match(UUID id, String name, String orgUnit) { }
	private record Member(UUID id, String name, String fullName, String orgUnit) { }
	private record IndexedMember(Member source, String name, String fullName) { }
}
