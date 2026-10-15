package com.skillhub.infra.logs;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.skillhub.session.AuthPrincipalResolver;
import com.skillhub.session.CurrentUser;
import com.skillhub.session.SessionService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.boot.web.servlet.context.AnnotationConfigServletWebServerApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.DispatcherServlet;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Real Tomcat routing, servlet encoding and MVC diagnostics, without a database. */
class LogsHttpTransportTest {
    @TempDir Path dir;
    AnnotationConfigServletWebServerApplicationContext context;
    InfraLogsProperties properties;
    LogFixtures.MutableClock clock;
    SessionService sessions;
    HttpClient client;
    String origin;
    Logger diagnostics;
    Level previousLevel;
    ListAppender<ILoggingEvent> messages;

    @Configuration(proxyBeanMethods = false)
    @EnableWebMvc
    static class HttpConfiguration implements WebMvcConfigurer {
        private final SessionService sessions;
        HttpConfiguration(SessionService sessions) { this.sessions = sessions; }
        @Override public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
            resolvers.add(new AuthPrincipalResolver(sessions));
        }
        @Override public void addInterceptors(org.springframework.web.servlet.config.annotation.InterceptorRegistry registry) {
            registry.addInterceptor(new com.skillhub.session.PasswordChangeInterceptor(sessions));
        }
        @Bean TomcatServletWebServerFactory servletWebServerFactory() throws Exception {
            var factory = new TomcatServletWebServerFactory(0);
            factory.setAddress(InetAddress.getLoopbackAddress());
            return factory;
        }
        @Bean ServletRegistrationBean<DispatcherServlet> dispatcherServlet(org.springframework.web.context.WebApplicationContext applicationContext) {
            var registration = new ServletRegistrationBean<>(new DispatcherServlet(applicationContext), "/");
            registration.addInitParameter("enableLoggingRequestDetails", "true");
            registration.setAsyncSupported(true);
            return registration;
        }
        @Bean FilterRegistrationBean<LogsRequestFilter> logsFilter(InfraLogsProperties properties) {
            return new FilterRegistrationBean<>(new LogsRequestFilter(properties, LogFixtures.MAPPER));
        }
        @Bean LogsExceptionHandler logsExceptionHandler() { return new LogsExceptionHandler(); }
    }

    @BeforeEach void setup() throws Exception {
        LogFixtures.copy(dir);
        clock = new LogFixtures.MutableClock();
        properties = LogFixtures.properties(dir);
        var store = new SanitizedLogStore(properties, LogFixtures.MAPPER, clock, 10000, 10);
        store.refresh();
        // Keep scheduled jobs dormant; each request explicitly controls the flag and clock.
        properties.setEnabled(false);
        sessions = mock(SessionService.class);
        when(sessions.getCurrentUser(any(HttpServletRequest.class))).thenReturn(
                new CurrentUser("synthetic-account", "student", "Student", "Team", "user", false));
        var limiter = new LogsAccessLimiter(clock);
        var streams = new InfraLogStreams(properties, store, limiter, sessions, LogFixtures.MAPPER, clock,
                () -> new org.springframework.web.servlet.mvc.method.annotation.SseEmitter(900_000L));
        context = new AnnotationConfigServletWebServerApplicationContext();
        context.registerBean(SessionService.class, () -> sessions);
        context.registerBean(InfraLogsProperties.class, () -> properties);
        context.registerBean(SanitizedLogStore.class, () -> store);
        context.registerBean(InfraLogStreams.class, () -> streams);
        context.registerBean(LogsAccessLimiter.class, () -> limiter);
        context.registerBean(InfraLogsController.class);
        context.register(HttpConfiguration.class);
        context.refresh();
        origin = "http://localhost:" + context.getWebServer().getPort();
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        diagnostics = (Logger) LoggerFactory.getLogger(DispatcherServlet.class);
        previousLevel = diagnostics.getLevel();
        diagnostics.setLevel(Level.DEBUG);
        messages = new ListAppender<>();
        messages.start();
        diagnostics.addAppender(messages);
    }

    @AfterEach void cleanup() {
        if (diagnostics != null) {
            diagnostics.detachAppender(messages);
            diagnostics.setLevel(previousLevel);
        }
        if (client != null) client.close();
        if (context != null) context.close();
    }

    private HttpResponse<byte[]> get(String path) throws Exception {
        clock.advance(2);
        return client.send(HttpRequest.newBuilder(URI.create(origin + path)).timeout(Duration.ofSeconds(5)).build(),
                HttpResponse.BodyHandlers.ofByteArray());
    }

    @ParameterizedTest
    @ValueSource(strings = {"/api/infra/logs/api-gateway", "/api/infra/logs/api-gateway;v1",
            "/%61pi/infra/logs/api-gateway", "/api/infra/logs/%61pi-gateway"})
    void equivalentPathsHonorFlagCachePolicyAndHideQueryDiagnostics(String base) throws Exception {
        for (boolean enabled : new boolean[]{false, true}) {
            properties.setEnabled(enabled);
            for (String suffix : new String[]{"", "/status", "/stream"}) {
                var response = get(base + suffix + "?q=synthetic-query-sentinel");
                assertThat(response.statusCode()).as("enabled=%s path=%s%s", enabled, base, suffix)
                        .isEqualTo(!enabled ? 404 : suffix.isEmpty() ? 200 : 400);
                assertThat(response.headers().firstValue("Cache-Control")).contains(LogsRequestFilter.CACHE_CONTROL);
                assertThat(messages.list).extracting(ILoggingEvent::getFormattedMessage)
                        .allSatisfy(message -> assertThat(message).doesNotContain("synthetic-query-sentinel"));
            }
        }
    }

    @Test void encodedSlashIsRejectedBeforeMvcWithoutLoggingQuery() throws Exception {
        for (boolean enabled : new boolean[]{false, true}) {
            properties.setEnabled(enabled);
            for (String suffix : new String[]{"", "/status", "/stream"}) {
                assertThat(get("/api/infra%2Flogs/api-gateway" + suffix + "?q=synthetic-query-sentinel").statusCode())
                        .isIn(400, 404);
            }
        }
        verifyNoInteractions(sessions);
        assertThat(messages.list).extracting(ILoggingEvent::getFormattedMessage)
                .allSatisfy(message -> assertThat(message).doesNotContain("synthetic-query-sentinel"));
    }

}
