package com.skillhub.oauth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.RemoteJWKSet;
import com.nimbusds.jose.proc.BadJOSEException;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.MalformedURLException;
import java.net.URL;
import java.text.ParseException;
import java.util.Optional;
import java.util.Set;

/**
 * Valida access tokens JWT emitidos por Ory Hydra para /api/mcp.
 *
 * A proposito NO usa spring-security-oauth2-jose ni ningun starter de Spring
 * Security: solo el SDK de Nimbus (com.nimbusds:oauth2-oidc-sdk), igual de
 * "a mano" que ApiKeyService. Asi, la validacion de OAuth no mete Spring
 * Security en el classpath ni puede afectar ningun otro endpoint.
 *
 * STRATEGIES_ACCESS_TOKEN=jwt en Hydra hace que el token sea auto-contenido:
 * esto valida firma + issuer + expiracion contra el JWKS publico de Hydra sin
 * llamarlo en cada request de MCP.
 */
@Component
public class HydraJwtValidator {

    private static final Logger log = LoggerFactory.getLogger(HydraJwtValidator.class);

    private final DefaultJWTProcessor<SecurityContext> processor;

    public HydraJwtValidator(@Value("${app.hydra.jwks-uri}") String jwksUri,
                              @Value("${app.hydra.issuer}") String issuer) throws MalformedURLException {
        JWKSource<SecurityContext> jwkSource = new RemoteJWKSet<>(new URL(jwksUri));
        JWSVerificationKeySelector<SecurityContext> keySelector =
                new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, jwkSource);

        this.processor = new DefaultJWTProcessor<>();
        this.processor.setJWSKeySelector(keySelector);
        this.processor.setJWTClaimsSetVerifier(new DefaultJWTClaimsVerifier<>(
                new JWTClaimsSet.Builder().issuer(issuer).build(),
                Set.of("sub", "exp")));
    }

    /** Devuelve el claim "sub" (el userId que pasamos al aceptar el login), o vacio si el token no es valido. */
    public Optional<String> validateAndGetSubject(String bearerToken) {
        if (bearerToken == null || !bearerToken.startsWith("Bearer ")) return Optional.empty();
        String jwt = bearerToken.substring(7).trim();
        try {
            JWTClaimsSet claims = processor.process(jwt, null);
            return Optional.ofNullable(claims.getSubject());
        } catch (ParseException | BadJOSEException | JOSEException e) {
            log.debug("[oauth] token invalido: {}", e.getMessage());
            return Optional.empty();
        }
    }
}
