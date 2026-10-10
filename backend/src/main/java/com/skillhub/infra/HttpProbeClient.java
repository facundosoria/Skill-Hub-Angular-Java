package com.skillhub.infra;

import org.springframework.http.HttpHeaders;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;

/**
 * Small HTTP client for registry and probe calls with explicit timeouts and
 * redirects disabled, so a compromised or misconfigured destination cannot
 * bounce us to an unapproved host. A 3xx is surfaced as-is and treated as a
 * failure by callers; it is never followed.
 */
@Component
public class HttpProbeClient {

    private final RestClient client;

    public HttpProbeClient(InfraProperties properties) {
        Duration connect = properties.getConnectTimeout();
        Duration read = properties.getReadTimeout();
        HttpClient http = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(connect)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(read);
        this.client = RestClient.builder().requestFactory(factory).build();
    }

    public record Response(int status, String body) {
        public boolean ok() {
            return status >= 200 && status < 300;
        }

        /** Redirects are not followed; a 3xx is a failure for our purposes. */
        public boolean redirect() {
            return status >= 300 && status < 400;
        }
    }

    public Response get(URI uri) {
        try {
            return client.get()
                    .uri(uri)
                    .header(HttpHeaders.ACCEPT, "application/json, text/plain;q=0.5, */*;q=0.1")
                    .exchange((request, response) -> {
                        String body = response.bodyTo(String.class);
                        return new Response(response.getStatusCode().value(), body == null ? "" : body);
                    });
        } catch (Exception e) {
            throw new ProbeException("request_failed", e);
        }
    }

    public static class ProbeException extends RuntimeException {
        private final String token;

        public ProbeException(String token, Throwable cause) {
            super(token, cause);
            this.token = token;
        }

        public String token() {
            return token;
        }
    }
}
