import java.util.List;

/** A runnable introduction. Requires Java 17 or later. */
public record Developer(
        String name,
        String strongestLanguage,
        List<String> builds
) {
    // Understand → build → refine
    public static void main(String[] args) {
        var me = new Developer(
                "Vihanga Thathsara Manukulasooriya",
                "Java",
                List.of("Backend systems", "Web applications", "Native Android apps")
        );

        System.out.println(me.name());
        System.out.println("Full-Stack Software Engineer");
        System.out.println("Software Engineering undergraduate, completing my degree");
        System.out.println("Strongest language: " + me.strongestLanguage());
        System.out.println("Building: " + String.join(", ", me.builds()));
        System.out.println("Priorities: readable code, input validation, authentication, role-based access");
        System.out.println("Focus: preparing public projects with clear setup guides and demonstrations");
        System.out.println("Open to collaboration on practical software projects");
        System.out.println("Email: vihangathegreat2006@gmail.com");
        System.out.println("GitHub: https://github.com/VihangaThathsara");
        System.out.println("LinkedIn: https://www.linkedin.com/in/vihanga-thathsara-00187543b/");
    }
}
