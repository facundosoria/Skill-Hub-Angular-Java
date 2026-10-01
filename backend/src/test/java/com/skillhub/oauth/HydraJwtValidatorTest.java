package com.skillhub.oauth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class HydraJwtValidatorTest {

    private static final String ISSUER = "https://issuer.test/";
    private static final String RESOURCE = "https://hub.test/api/mcp";
    private static final String USER_ID = "5f8d5d3e-8b2a-45fb-9b50-9b9c9e9c9f21";
    private static final String KEY_ID = "hydra-test-key";

    private static RSAKey signingKey;
    private static HttpServer jwksServer;

    @BeforeAll
    static void startJwksServer() throws Exception {
        signingKey = new RSAKeyGenerator(2048)
                .keyID(KEY_ID)
                .algorithm(JWSAlgorithm.RS256)
                .keyUse(KeyUse.SIGNATURE)
                .generate();
        byte[] jwks = new ObjectMapper().writeValueAsBytes(Map.of(
                "keys", List.of(signingKey.toPublicJWK().toJSONObject())));
        jwksServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        jwksServer.createContext("/jwks", exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, jwks.length);
            try (var body = exchange.getResponseBody()) {
                body.write(jwks);
            }
        });
        jwksServer.start();
    }

    @AfterAll
    static void stopJwksServer() {
        if (jwksServer != null) jwksServer.stop(0);
    }

    @Test
    void validRs256TokenWithHydraClaimsReturnsSubject() throws Exception {
        HydraJwtValidator validator = validator();
        String validToken = token(new JWTClaimsSet.Builder().expirationTime(future()).build());
        assertThat(SignedJWT.parse(validToken).getJWTClaimsSet().getAudience()).containsExactly(RESOURCE);

        assertThat(validator.validateAndGetSubject("Bearer " + validToken))
                .contains(USER_ID);
    }

    @Test
    void expiredTokenIsRejected() throws Exception {
        assertThat(validator().validateAndGetSubject("Bearer " + token(
                new JWTClaimsSet.Builder().expirationTime(new Date(System.currentTimeMillis() - 60_000)).build())))
                .isEmpty();
    }

    @Test
    void manipulatedSignatureIsRejected() throws Exception {
        String signed = token(new JWTClaimsSet.Builder().expirationTime(future()).build());
        String[] segments = signed.split("\\.", -1);
        byte[] signature = Base64.getUrlDecoder().decode(segments[2]);
        signature[0] ^= 0x01;
        String manipulated = segments[0] + "." + segments[1] + "."
                + Base64.getUrlEncoder().withoutPadding().encodeToString(signature);

        assertThat(validator().validateAndGetSubject("Bearer " + manipulated)).isEmpty();
    }

    @Test
    void wrongIssuerIsRejected() throws Exception {
        assertThat(validator().validateAndGetSubject("Bearer " + token(
                new JWTClaimsSet.Builder().issuer("https://other-issuer.test/").expirationTime(future()).build())))
                .isEmpty();
    }

    @Test
    void wrongAudienceIsRejected() throws Exception {
        assertThat(validator().validateAndGetSubject("Bearer " + token(
                new JWTClaimsSet.Builder().audience("https://other.test/api/mcp").expirationTime(future()).build())))
                .isEmpty();
    }

    @Test
    void missingMcpScopeIsRejected() throws Exception {
        assertThat(validator().validateAndGetSubject("Bearer " + token(
                new JWTClaimsSet.Builder().claim("scope", "openid profile").expirationTime(future()).build())))
                .isEmpty();
    }

    @Test
    void mcpMustBeASeparateScopeValue() throws Exception {
        assertThat(validator().validateAndGetSubject("Bearer " + token(
                new JWTClaimsSet.Builder().claim("scope", "mcp-read").expirationTime(future()).build())))
                .isEmpty();
    }

    @Test
    void scpArrayContainingMcpReturnsSubject() throws Exception {
        assertThat(validator().validateAndGetSubject("Bearer " + token(
                new JWTClaimsSet.Builder().claim("scp", List.of("openid", "mcp"))
                        .expirationTime(future()).build())))
                .contains(USER_ID);
    }

    @Test
    void scpArrayWithoutMcpIsRejected() throws Exception {
        assertThat(validator().validateAndGetSubject("Bearer " + token(
                new JWTClaimsSet.Builder().claim("scp", List.of("openid", "offline_access"))
                        .expirationTime(future()).build())))
                .isEmpty();
    }

    private static HydraJwtValidator validator() throws Exception {
        return new HydraJwtValidator(
                "http://127.0.0.1:" + jwksServer.getAddress().getPort() + "/jwks",
                ISSUER,
                RESOURCE);
    }

    private static String token(JWTClaimsSet requested) throws Exception {
        JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder()
                .issuer(requested.getIssuer() == null ? ISSUER : requested.getIssuer())
                .subject(requested.getSubject() == null ? USER_ID : requested.getSubject())
                .expirationTime(requested.getExpirationTime() == null ? future() : requested.getExpirationTime());
        if (requested.getClaim("scope") != null) {
            claims.claim("scope", requested.getClaim("scope"));
        } else if (requested.getClaim("scp") != null) {
            claims.claim("scp", requested.getClaim("scp"));
        } else {
            claims.claim("scope", "mcp");
        }
        if (requested.getAudience().isEmpty()) claims.audience(RESOURCE);
        else claims.audience(requested.getAudience());

        SignedJWT signed = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(KEY_ID).build(),
                claims.build());
        signed.sign(new RSASSASigner(signingKey));
        return signed.serialize();
    }

    private static Date future() {
        return new Date(System.currentTimeMillis() + 300_000);
    }
}
