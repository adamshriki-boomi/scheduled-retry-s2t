/**
 * GET /api/connections/list → IConnection[]  (bare array, not paginated)
 *
 * The Connections table renders name, a type icon (<img src={`/${icon}`}>),
 * and modified time. `icon` is a real asset path; `connection_type` doubles as
 * the modal header + type. The store keys connections by cross_id.
 */
import { ACCOUNT_ID, ENV_PROD_ID } from '../fixtures';
import { connectorById, iconRel, oid } from './_shared';
import { CONNECTIONS } from './seed';
import { DEMO_CONNECTIONS } from './s2t.metadata';
import { getOId } from '../../utils/api.sanitizer';

export const connectionsList = CONNECTIONS.map(c => {
  const connector = connectorById(c.connector);
  return {
    _id: oid(c.cross),
    cross_id: oid(c.cross),
    account: oid(ACCOUNT_ID),
    env_id: ENV_PROD_ID,
    connection_name: c.label,
    connection_type: connector.id,
    connection_type_id: connector.id,
    connection_type_name: connector.name,
    connection_creation_time: { $date: c.created },
    connection_update_time: { $date: c.updated },
    connection_update_by: c.modifiedBy,
    updated_by_name: c.modifiedBy,
    icon: iconRel(connector.icon),
    size: 28,
    valid: c.valid,
    is_test_connection: false,
    is_test_connection_list: false,
    last_test_date: { $date: c.updated },
  };
});

/**
 * GET /api/connections — the S2T wizard fetches connections two ways:
 *   ?connection_type=mysql|snowflake  (fetchConnectionsByType redux thunk) → bare array
 *   ?_id=<crossId>                    (useGetConnectionQuery)              → bare array (reads [0])
 * Both return `IConnectionType[]`. We only serve the two demo connections the
 * wizard walks with ("test shiran" MySQL + "Rivery Snowflake").
 */
export const connectionsByType = (opts: {
  connectionType?: string | null;
  id?: string | null;
}) => {
  if (opts.id) {
    return DEMO_CONNECTIONS.filter(c => getOId(c.cross_id) === opts.id);
  }
  if (opts.connectionType) {
    return DEMO_CONNECTIONS.filter(
      c => c.connection_type === opts.connectionType,
    );
  }
  return DEMO_CONNECTIONS;
};
