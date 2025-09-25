export async function insertTDetenido(
    client,
    {
        snombre = '',
        sapellidopaterno = '',
        sapellidomaterno = '',
        snombrenormalizado = '',
        irepeticiones = 0,
        salias = '',
        ssexo = 'M',
        dtfecha = null
    }
) {
    const query = `
        INSERT INTO tdetenido (snombre, sapellidopaterno, sapellidomaterno, snombrenormalizado, irepeticiones, salias, ssexo, dtfecha)
        VALUES($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_TIMESTAMP))
        RETURNING iiddetenido;
    `
    const values = [
        snombre,
        sapellidopaterno,
        sapellidomaterno,
        snombrenormalizado,
        irepeticiones,
        salias,
        ssexo,
        dtfecha
    ]

    try {
        const result = await client.query(query, values)
        return result.rows[0]
    } catch (error) {
        console.error('Error al insertar en tdetenido:', error.message)
        throw error
    }
}