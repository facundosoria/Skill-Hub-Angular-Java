package com.skillhub.agentroom;

import com.skillhub.auth.ApiKeyIdentity;
import com.skillhub.session.CurrentUser;

/**
 * Quien actua en una sala, sin importar el canal: la web (humano) o el MCP
 * (agente). El equipo SIEMPRE sale de la identidad autenticada, nunca de los
 * argumentos, para que un agente no pueda hablar en nombre de otro equipo.
 */
public record RoomActor(
        String userId,
        String name,
        String team,
        boolean admin,
        String apiKeyId,
        String kind
) {
    public static RoomActor human(CurrentUser user) {
        return new RoomActor(user.id(), user.name(), user.team(), user.isAdmin(), null, "human");
    }

    public static RoomActor agent(ApiKeyIdentity identity) {
        return new RoomActor(identity.userId(), identity.username(), identity.team(),
                "admin".equals(identity.role()), identity.apiKeyId(), "agent");
    }

    public boolean hasTeam() {
        return team != null && !team.isBlank();
    }
}
