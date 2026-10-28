package wtf.hackhub.application.idea;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/** Matches the supplied employee roster against claims saved only during verified SSO login. */
@Service
public class NominationApprovalDirectory {
	public record Employee(String email, String nt, String name, String orgUnit, String nominatingHead,
			String hodNt, String hodEmail, boolean allowSelfApproval) { }
	private final JdbcTemplate jdbc;
	private final List<Employee> employees;
	public NominationApprovalDirectory(JdbcTemplate jdbc, ObjectMapper mapper) throws IOException {
		this.jdbc = jdbc;
		try (var input = new ClassPathResource("nomination-roster.json").getInputStream()) {
			employees = mapper.readValue(input, new TypeReference<List<Employee>>() { });
		}
	}
	public Optional<String> verifiedEmail(UUID profileId) {
		var matches = jdbc.query("SELECT DISTINCT lower(verified_email) FROM sso_identities WHERE profile_id = ? AND verified_email IS NOT NULL",
				(rs, row) -> rs.getString(1), profileId);
		return matches.size() == 1 ? Optional.of(matches.get(0)) : Optional.empty();
	}
	public Optional<Employee> employee(UUID profileId) {
		return verifiedEmail(profileId).flatMap(email -> {
			var matches = employees.stream().filter(e -> email.equalsIgnoreCase(e.email())).toList();
			return matches.size() == 1 ? Optional.of(matches.get(0)) : Optional.empty();
		});
	}
	public Optional<String> reviewerKey(UUID profileId) {
		return verifiedEmail(profileId).filter(email -> employees.stream()
				.anyMatch(e -> e.hodEmail() != null && email.equalsIgnoreCase(e.hodEmail())));
	}
	public Employee requireEmployee(UUID profileId) {
		var employee = employee(profileId).orElseThrow(() -> new IllegalArgumentException(
				"Sign in with Bosch SSO using an email listed in the employee roster before submitting."));
		if (employee.hodEmail() == null || employee.hodEmail().isBlank())
			throw new IllegalArgumentException("The roster does not provide a verified email for your Nominating HoD. Contact an administrator.");
		if (employee.email().equalsIgnoreCase(employee.hodEmail()) && !employee.allowSelfApproval())
			throw new IllegalArgumentException("Your Nominating HoD cannot approve their own nomination. Contact an administrator.");
		return employee;
	}
	public boolean allowsSelfApproval(UUID profileId) {
		return employee(profileId).filter(Employee::allowSelfApproval)
				.filter(e -> e.hodEmail() != null && e.email().equalsIgnoreCase(e.hodEmail())).isPresent();
	}
	public String headKey(Employee employee) { return employee.hodEmail().toLowerCase(Locale.ROOT); }
}
