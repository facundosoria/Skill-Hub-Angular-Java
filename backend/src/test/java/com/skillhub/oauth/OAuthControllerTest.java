package com.skillhub.oauth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class OAuthControllerTest {

    private FakeHydraAdminClient hydra;
    private OAuthController controller;

    @BeforeEach
    void setUp() {
        hydra = new FakeHydraAdminClient();
        controller = new OAuthController(
                null,
                hydra,
                "https://hub.test/api/mcp",
                "https://hub.test/",
                "http://hydra:4444");
    }

    @Test
    void exposesOnlySafeConsentDataFromHydra() throws Exception {
        hydra.request = new ObjectMapper().readTree("""
                {
                  "client": {"client_name": "Claude"},
                  "requested_scope": ["openid", "offline"],
                  "subject": "user-that-must-not-leak"
                }
                """);

        Map<String, Object> response = controller.consentRequest("challenge-1");

        assertThat(response).containsEntry("clientName", "Claude");
        assertThat(response).containsEntry("requestedScopes", List.of("openid", "offline"));
        assertThat(response).doesNotContainKey("subject");
    }

    @Test
    void acceptsConsentUsingTheHydraChallengeOnly() {
        hydra.acceptRedirect = "https://client.test/callback?code=abc";

        Map<String, Object> response = controller.acceptConsent(Map.of(
                "consentChallenge", "challenge-1",
                "requestedScopes", List.of("scope-forged-by-browser")));

        assertThat(response).containsEntry("redirectTo", hydra.acceptRedirect);
        assertThat(hydra.acceptedChallenge).isEqualTo("challenge-1");
    }

    @Test
    void rejectsConsentAndReturnsHydrasRedirect() {
        hydra.rejectRedirect = "https://client.test/callback?error=access_denied";

        Map<String, Object> response = controller.rejectConsent(Map.of("consentChallenge", "challenge-1"));

        assertThat(response).containsEntry("redirectTo", hydra.rejectRedirect);
        assertThat(hydra.rejectedChallenge).isEqualTo("challenge-1");
    }

    @Test
    void protectedResourceMetadataAdvertisesOnlyTheMcpResourceScope() {
        Map<String, Object> response = controller.protectedResourceMetadata();

        assertThat(response).containsEntry("resource", "https://hub.test/api/mcp");
        assertThat(response).containsEntry("scopes_supported", List.of("mcp"));
        assertThat(response).containsEntry("bearer_methods_supported", List.of("header"));
    }

    private static final class FakeHydraAdminClient extends HydraAdminClient {
        private JsonNode request;
        private String acceptedChallenge;
        private String rejectedChallenge;
        private String acceptRedirect = "https://client.test/callback?code=default";
        private String rejectRedirect = "https://client.test/callback?error=access_denied";

        private FakeHydraAdminClient() {
            super("http://hydra.invalid");
        }

        @Override
        public JsonNode getConsentRequest(String consentChallenge) {
            return request;
        }

        @Override
        public String acceptConsent(String consentChallenge) {
            acceptedChallenge = consentChallenge;
            return acceptRedirect;
        }

        @Override
        public String rejectConsent(String consentChallenge) {
            rejectedChallenge = consentChallenge;
            return rejectRedirect;
        }
    }
}
