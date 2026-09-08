package com.skillhub.session;

import org.bouncycastle.crypto.generators.SCrypt;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Puerto de src/server/auth/password.ts.
 *
 * Formato guardado: scrypt$N$r$p$saltB64$keyB64 (los parametros viven junto al
 * hash para poder subirlos sin invalidar los viejos). Compatible byte a byte
 * con los hashes que ya genero el proyecto Next: verifyPassword de aca lee un
 * hash escrito por Node y viceversa.
 */
@Component
public class PasswordHasher {

    private static final int N = 16384;
    private static final int R = 8;
    private static final int P = 1;
    private static final int KEYLEN = 64;
    private static final SecureRandom RNG = new SecureRandom();

    public String hash(String password) {
        byte[] salt = new byte[16];
        RNG.nextBytes(salt);
        byte[] key = SCrypt.generate(password.getBytes(StandardCharsets.UTF_8), salt, N, R, P, KEYLEN);
        return "scrypt$" + N + "$" + R + "$" + P + "$"
                + Base64.getEncoder().encodeToString(salt) + "$"
                + Base64.getEncoder().encodeToString(key);
    }

    public boolean verify(String password, String stored) {
        String[] parts = stored == null ? new String[0] : stored.split("\\$");
        if (parts.length != 6 || !"scrypt".equals(parts[0])) return false;
        int n = Integer.parseInt(parts[1]);
        int r = Integer.parseInt(parts[2]);
        int p = Integer.parseInt(parts[3]);
        byte[] salt = Base64.getDecoder().decode(parts[4]);
        byte[] expected = Base64.getDecoder().decode(parts[5]);
        byte[] actual = SCrypt.generate(
                password.getBytes(StandardCharsets.UTF_8), salt, n, r, p, expected.length);
        return MessageDigest.isEqual(actual, expected);
    }
}
