package com.skillhub.infra;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.bind.PropertySourcesPlaceholdersResolver;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/** Guards the dependencies declared in application.yml against typos and self references. */
class InfraDependenciesConfigTest {

    private InfraProperties bound() throws IOException {
        List<PropertySource<?>> loaded = new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yml"));
        MutablePropertySources sources = new MutablePropertySources();
        loaded.forEach(sources::addLast);
        Binder binder = new Binder(ConfigurationPropertySources.from(sources), new PropertySourcesPlaceholdersResolver(sources));
        return binder.bind("app.infra", Bindable.of(InfraProperties.class)).get();
    }

    @Test
    void declaredDependenciesOnlyReferenceCatalogueServicesAndNeverThemselves() throws IOException {
        InfraProperties properties = bound();
        Set<String> catalogue = properties.getCatalogue().stream()
                .map(InfraProperties.ServiceDefinition::getName).collect(Collectors.toSet());

        assertThat(properties.getDependencies()).isNotEmpty();
        assertThat(properties.getEvents()).isNotEmpty();
        List.of(properties.getDependencies(), properties.getEvents()).forEach(flows -> flows.forEach((source, targets) -> {
            assertThat(catalogue).as("source %s", source).contains(source);
            assertThat(targets).as("targets of %s", source).isNotEmpty().doesNotHaveDuplicates()
                    .doesNotContain(source).allSatisfy(target -> assertThat(catalogue).contains(target));
        }));
    }

    @Test
    void everyCatalogueServiceHasAtLeastOneRelation() throws IOException {
        InfraProperties properties = bound();
        Set<String> related = new java.util.HashSet<>();
        List.of(properties.getDependencies(), properties.getEvents()).forEach(flows -> flows.forEach((source, targets) -> {
            related.add(source);
            related.addAll(targets);
        }));
        Set<String> catalogue = properties.getCatalogue().stream()
                .map(InfraProperties.ServiceDefinition::getName).collect(Collectors.toSet());
        // sandbox-service is related only through the gateway: the catalogue names no consumer of sandbox.events.
        assertThat(catalogue).allSatisfy(name -> assertThat(related).as("%s has relations", name).contains(name));
    }
}
