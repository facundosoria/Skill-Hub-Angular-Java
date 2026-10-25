package com.skillhub.infra;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class InfraQueryServiceDependenciesTest {

    private InfraDto.StateView view(Map<String, List<String>> dependencies) {
        return view(dependencies, Map.of());
    }

    private InfraDto.StateView view(Map<String, List<String>> dependencies, Map<String, List<String>> events) {
        InfraProperties properties = new InfraProperties();
        properties.setDependencies(dependencies);
        properties.setEvents(events);
        InfraRepository repository = mock(InfraRepository.class);
        when(repository.loadStates()).thenReturn(Map.of());
        when(repository.loadServiceSamples(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()))
                .thenReturn(List.of());
        Clock clock = Clock.fixed(Instant.parse("2026-10-06T00:00:00Z"), ZoneOffset.UTC);
        return new InfraQueryService(properties, repository, new AvailabilityCalculator(Duration.ofSeconds(90)), clock)
                .current();
    }

    private List<String> dependsOn(InfraDto.StateView view, String service) {
        return view.services().stream().filter(s -> s.name().equals(service)).findFirst().orElseThrow().dependsOn();
    }

    @Test
    void dependsOnIsEmptyWhenNothingIsConfigured() {
        assertThat(view(Map.of()).services()).allSatisfy(s -> assertThat(s.dependsOn()).isEmpty());
    }

    @Test
    void dependsOnKeepsOnlyCatalogueServicesWithoutSelfOrDuplicates() {
        InfraDto.StateView view = view(Map.of(
                "api-gateway", List.of("users-service", "users-service", "api-gateway", "unknown-service", "course-service")));
        assertThat(dependsOn(view, "api-gateway")).containsExactly("users-service", "course-service");
        assertThat(dependsOn(view, "users-service")).isEmpty();
    }

    @Test
    void publishesToIsIndependentFromDependsOnAndSanitizedTheSameWay() {
        InfraDto.StateView view = view(
                Map.of("api-gateway", List.of("users-service")),
                Map.of("llm-service", List.of("course-service", "course-service", "llm-service", "nope")));
        InfraDto.ServiceView llm = view.services().stream().filter(s -> s.name().equals("llm-service")).findFirst().orElseThrow();
        assertThat(llm.publishesTo()).containsExactly("course-service");
        assertThat(llm.dependsOn()).isEmpty();
        assertThat(dependsOn(view, "api-gateway")).containsExactly("users-service");
    }
}
