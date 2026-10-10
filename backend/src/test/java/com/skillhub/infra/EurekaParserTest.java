package com.skillhub.infra;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class EurekaParserTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private Map<String, List<ServiceInstance>> parse(String json) throws Exception {
        return EurekaParser.parse(mapper.readTree(json));
    }

    @Test
    void parsesSingletonApplicationAndSingletonInstance() throws Exception {
        String json = """
                {
                  "application": {
                    "name": "USERS-SERVICE",
                    "instance": {
                      "instanceId": "users-1",
                      "hostName": "users-service",
                      "ipAddr": "100.64.1.20",
                      "app": "USERS-SERVICE",
                      "status": "UP",
                      "port": { "$": 8080, "@enabled": "true" },
                      "securePort": { "$": 0, "@enabled": "false" },
                      "metadata": { "management.port": "9090" }
                    }
                  }
                }
                """;
        var result = parse(json);
        assertThat(result).containsKey("USERS-SERVICE");
        List<ServiceInstance> instances = result.get("USERS-SERVICE");
        assertThat(instances).hasSize(1);
        assertThat(instances.get(0).hostName()).isEqualTo("users-service");
        assertThat(instances.get(0).ipAddr()).isEqualTo("100.64.1.20");
        assertThat(instances.get(0).registryState()).isEqualTo(RegistryState.UP);
        assertThat(instances.get(0).managementPort()).isEqualTo(9090);
    }

    @Test
    void parsesListOfApplicationsAndInstancesWithoutDroppingReplicas() throws Exception {
        String json = """
                {
                  "applications": {
                    "versions__delta": "1",
                    "application": [
                      {
                        "name": "USERS-SERVICE",
                        "instance": [
                          { "instanceId": "u1", "hostName": "users-service", "status": "UP", "port": { "$": 8080 } },
                          { "instanceId": "u2", "hostName": "users-service", "status": "UP", "port": { "$": 8080 } }
                        ]
                      },
                      {
                        "name": "LLM-SERVICE",
                        "instance": {
                          "instanceId": "l1", "hostName": "llm-service", "status": "DOWN", "port": { "$": 8080 }
                        }
                      }
                    ]
                  }
                }
                """;
        var result = parse(json);
        assertThat(result.get("USERS-SERVICE")).hasSize(2);
        assertThat(result.get("LLM-SERVICE")).hasSize(1);
        assertThat(result.get("LLM-SERVICE").get(0).registryState()).isEqualTo(RegistryState.DOWN);
    }

    @Test
    void missingMetadataMeansNoManagementPortInsteadOfAppPlusOne() throws Exception {
        String json = """
                { "application": { "name": "SANDBOX-SERVICE",
                  "instance": { "instanceId": "s1", "hostName": "sandbox-service", "status": "UP", "port": { "$": 8080 } } } }
                """;
        var instance = parse(json).get("SANDBOX-SERVICE").get(0);
        assertThat(instance.managementPort()).isNull();
        assertThat(instance.ipAddr()).isNull();
    }

    @Test
    void mapsOutOfServiceStatus() throws Exception {
        String json = """
                { "application": { "name": "X",
                  "instance": { "instanceId": "x1", "hostName": "x", "status": "OUT_OF_SERVICE", "port": { "$": 8080 } } } }
                """;
        assertThat(parse(json).get("X").get(0).registryState()).isEqualTo(RegistryState.OUT_OF_SERVICE);
    }

    @Test
    void disabledSecurePortWithPositiveNumberStaysPlainHttp() throws Exception {
        String json = """
                { "application": { "name": "USERS-SERVICE",
                  "instance": { "instanceId": "u1", "hostName": "users-service", "status": "UP",
                    "port": { "$": 8080 }, "securePort": { "$": 443, "@enabled": "false" } } } }
                """;
        ServiceInstance instance = parse(json).get("USERS-SERVICE").get(0);
        assertThat(instance.securePort()).isEqualTo(443);
        assertThat(instance.secureManagement()).isFalse();
    }

    @Test
    void enabledSecurePortWithPositiveNumberUsesTls() throws Exception {
        String json = """
                { "application": { "name": "USERS-SERVICE",
                  "instance": { "instanceId": "u1", "hostName": "users-service", "status": "UP",
                    "port": { "$": 8080 }, "securePort": { "$": 8443, "@enabled": "true" } } } }
                """;
        assertThat(parse(json).get("USERS-SERVICE").get(0).secureManagement()).isTrue();
    }

    @Test
    void missingSecurePortDoesNotUseTls() throws Exception {
        String json = """
                { "application": { "name": "USERS-SERVICE",
                  "instance": { "instanceId": "u1", "hostName": "users-service", "status": "UP",
                    "port": { "$": 8080 } } } }
                """;
        assertThat(parse(json).get("USERS-SERVICE").get(0).secureManagement()).isFalse();
    }

    @Test
    void bareSecurePortValueKeepsCurrentBehaviour() throws Exception {
        String numeric = """
                { "application": { "name": "A",
                  "instance": { "instanceId": "a1", "hostName": "a", "status": "UP",
                    "port": { "$": 8080 }, "securePort": 8443 } } }
                """;
        assertThat(parse(numeric).get("A").get(0).secureManagement()).isTrue();

        String textual = """
                { "application": { "name": "B",
                  "instance": { "instanceId": "b1", "hostName": "b", "status": "UP",
                    "port": { "$": 8080 }, "securePort": "8443" } } }
                """;
        assertThat(parse(textual).get("B").get(0).secureManagement()).isTrue();
    }
}
