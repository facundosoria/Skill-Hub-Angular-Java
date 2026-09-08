package com.skillhub.web;

/** Puerto de SkillError: error de negocio que vuelve como 400 {"error": mensaje}. */
public class DomainException extends RuntimeException {
    public DomainException(String message) {
        super(message);
    }
}
