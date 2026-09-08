package com.skillhub.session;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Inyecta el {@link CurrentUser} de la cookie de sesion en un parametro de
 * controlador. Por defecto exige sesion (401 si no hay); required=false lo
 * deja pasar como null (para endpoints que se comportan distinto logueado).
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface AuthPrincipal {
    boolean required() default true;
}
